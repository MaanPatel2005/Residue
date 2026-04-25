"""
Residue — CorrelationAgent (Fetch.ai uAgents + ASI1-Mini)

Long-running agent that consumes session data, builds the user's
personal acoustic-to-state model, and uses ASI1-Mini to generate
insights about the user's acoustic preferences.

Runs on a 5-minute interval AND on demand via message.
"""

import os
import json
import math
import requests
from pathlib import Path
from dotenv import load_dotenv
from uagents import Agent, Context, Model
from typing import Optional

# Load .env from project root so ASI1_API_KEY is available
load_dotenv(Path(__file__).parent.parent.parent / ".env")


# ── Data Models ──────────────────────────────────────────────────────────────

class CorrelationRequest(Model):
    user_id: str
    sessions: str  # JSON-serialized list of session data

class CorrelationResponse(Model):
    user_id: str
    optimal_db: float
    db_range: list[float]
    eq_gains: list[float]  # 7-band
    preferred_bands: list[str]
    confidence: float
    insight: str  # ASI1-Mini generated insight
    data_points: int

class ProfileQueryRequest(Model):
    user_id: str

class ProfileQueryResponse(Model):
    user_id: str
    has_profile: bool
    profile_json: str  # JSON-serialized profile or empty


# ── ASI1-Mini Integration ────────────────────────────────────────────────────

ASI1_API_URL = "https://api.asi1.ai/v1/chat/completions"
BAND_LABELS = ["Sub-bass", "Bass", "Low-mid", "Mid", "Upper-mid", "Presence", "Brilliance"]

def call_asi1_mini(system_prompt: str, user_prompt: str) -> str:
    api_key = os.environ.get("ASI1_API_KEY", "")
    if not api_key:
        return ""
    try:
        response = requests.post(
            ASI1_API_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            json={
                "model": "asi1-mini",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.4,
                "max_tokens": 200,
            },
            timeout=15,
        )
        if response.status_code == 200:
            return response.json()["choices"][0]["message"]["content"]
    except Exception:
        pass
    return ""


def build_optimal_profile(sessions_json: str) -> dict:
    """Analyze session data and build optimal acoustic profile."""
    try:
        sessions = json.loads(sessions_json)
    except json.JSONDecodeError:
        return {"error": "Invalid session data"}

    if len(sessions) < 2:
        return {"error": "Need at least 2 sessions", "data_points": len(sessions)}

    # Bucket by dB level
    db_buckets: dict[int, dict] = {}
    for s in sessions:
        acoustic = s.get("acoustic", {})
        productivity = s.get("productivity_score", 50)
        db = acoustic.get("overall_db", 50)
        bucket = round(db / 5) * 5
        if bucket not in db_buckets:
            db_buckets[bucket] = {"total_prod": 0, "count": 0}
        db_buckets[bucket]["total_prod"] += productivity
        db_buckets[bucket]["count"] += 1

    # Find best dB
    best_db = 50
    best_avg = 0
    for db, data in db_buckets.items():
        avg = data["total_prod"] / data["count"]
        if avg > best_avg:
            best_avg = avg
            best_db = db

    # Build EQ gains from high-productivity sessions
    good_sessions = [s for s in sessions if s.get("productivity_score", 0) >= 60]
    eq_gains = [0.0] * 7
    eq_counts = [0] * 7
    for s in good_sessions:
        bands = s.get("acoustic", {}).get("frequency_bands", [])
        for i, mag in enumerate(bands[:7]):
            eq_gains[i] += mag
            eq_counts[i] += 1

    for i in range(7):
        eq_gains[i] = eq_gains[i] / eq_counts[i] if eq_counts[i] > 0 else 0.0

    avg_gain = sum(eq_gains) / 7 if any(eq_gains) else 0
    preferred_bands = [BAND_LABELS[i] for i in range(7) if eq_gains[i] > avg_gain]

    confidence = min(len(sessions) / 20, 1.0)

    # Get ASI1-Mini insight
    insight = generate_profile_insight(best_db, eq_gains, preferred_bands, len(sessions), confidence)

    return {
        "optimal_db": best_db,
        "db_range": [max(0, best_db - 5), best_db + 5],
        "eq_gains": [round(g, 4) for g in eq_gains],
        "preferred_bands": preferred_bands,
        "confidence": round(confidence, 2),
        "insight": insight,
        "data_points": len(sessions),
    }


def generate_profile_insight(optimal_db: float, eq_gains: list, preferred_bands: list, n_sessions: int, confidence: float) -> str:
    """Use ASI1-Mini to generate a human-readable insight about the user's profile."""
    system_prompt = """You are Residue's Correlation Agent. Given a user's optimal acoustic profile 
data, generate a brief, insightful explanation of their acoustic preferences and how it relates 
to their cognitive performance. Be specific about frequency ranges and dB levels.
Keep it to 2-3 sentences max."""

    band_desc = ", ".join(f"{BAND_LABELS[i]}: {eq_gains[i]:.2f}" for i in range(7))

    user_prompt = f"""User's learned acoustic profile (from {n_sessions} sessions, {confidence:.0%} confidence):
- Optimal dB: {optimal_db}
- EQ gains: {band_desc}
- Preferred bands: {', '.join(preferred_bands) if preferred_bands else 'none identified yet'}

Generate a brief insight about this user's acoustic preferences."""

    result = call_asi1_mini(system_prompt, user_prompt)
    return result if result else f"Your optimal environment is around {optimal_db} dB with emphasis on {', '.join(preferred_bands) if preferred_bands else 'balanced frequencies'}."


# ── Agent Setup ──────────────────────────────────────────────────────────────

def create_agent():
    AGENT_PORT = int(os.environ.get("CORRELATION_AGENT_PORT", "8771"))
    AGENT_SEED = os.environ.get("CORRELATION_AGENT_SEED", "residue-correlation-agent-seed-phrase-v1")

    # In-memory profile store (replaced by MongoDB in production)
    profiles: dict[str, dict] = {}

    _agent = Agent(
        name="residue_correlation_agent",
        port=AGENT_PORT,
        seed=AGENT_SEED,
        endpoint=[f"http://localhost:{AGENT_PORT}/submit"],
    )

    print(f"CorrelationAgent address: {_agent.address}")

    @_agent.on_event("startup")
    async def startup(ctx: Context):
        ctx.logger.info(f"CorrelationAgent started on port {AGENT_PORT}")
        ctx.logger.info(f"Address: {_agent.address}")

    @_agent.on_message(CorrelationRequest)
    async def handle_correlation(ctx: Context, sender: str, msg: CorrelationRequest):
        ctx.logger.info(f"Correlation request from {sender} for user {msg.user_id}")

        result = build_optimal_profile(msg.sessions)

        if "error" not in result:
            profiles[msg.user_id] = result

        response = CorrelationResponse(
            user_id=msg.user_id,
            optimal_db=result.get("optimal_db", 50),
            db_range=result.get("db_range", [45, 55]),
            eq_gains=result.get("eq_gains", [0]*7),
            preferred_bands=result.get("preferred_bands", []),
            confidence=result.get("confidence", 0),
            insight=result.get("insight", result.get("error", "")),
            data_points=result.get("data_points", 0),
        )

        await ctx.send(sender, response)
        ctx.logger.info(f"Sent correlation update: {result.get('optimal_db', 'N/A')} dB optimal")

    @_agent.on_message(ProfileQueryRequest)
    async def handle_profile_query(ctx: Context, sender: str, msg: ProfileQueryRequest):
        ctx.logger.info(f"Profile query from {sender} for user {msg.user_id}")

        profile = profiles.get(msg.user_id)
        response = ProfileQueryResponse(
            user_id=msg.user_id,
            has_profile=profile is not None,
            profile_json=json.dumps(profile) if profile else "",
        )
        await ctx.send(sender, response)

    return _agent


if __name__ == "__main__":
    agent = create_agent()
    agent.run()
