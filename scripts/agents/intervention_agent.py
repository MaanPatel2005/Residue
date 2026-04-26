"""
Residue — InterventionAgent (Fetch.ai uAgents + ASI1-Mini)

Given a cognitive goal (focus/calm/creative/social) and current perception,
uses ASI1-Mini to reason about the optimal acoustic intervention.
Computes EQ gap analysis and selects the best ambient bed.
"""

import os
import json
import requests
from datetime import datetime
from uuid import uuid4
from pathlib import Path
from dotenv import load_dotenv
from uagents import Agent, Context, Model, Protocol
from typing import Optional
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    TextContent,
    chat_protocol_spec,
)

# Load .env from project root so ASI1_API_KEY is available
load_dotenv(Path(__file__).parent.parent.parent / ".env")


# ── Data Models ──────────────────────────────────────────────────────────────

class InterventionRequest(Model):
    session_id: str
    goal_mode: str  # focus | calm | creative | social
    current_db: float
    current_bands: list[float]  # 7-band current magnitudes
    cognitive_state: str
    user_profile_json: str  # JSON of optimal profile, or empty

class InterventionResponse(Model):
    session_id: str
    goal_mode: str
    bed_selection: str
    eq_profile: list[float]  # 7-band target EQ
    volume_target: float
    reasoning: str  # ASI1-Mini explanation
    gap_analysis_json: str  # JSON of per-band gap


# ── ASI1-Mini Integration ────────────────────────────────────────────────────

ASI1_API_URL = "https://api.asi1.ai/v1/chat/completions"
BAND_LABELS = ["Sub-bass", "Bass", "Low-mid", "Mid", "Upper-mid", "Presence", "Brilliance"]

BED_OPTIONS = [
    "brown-noise", "pink-noise", "white-noise", "rain", "cafe", "binaural",
    "forest", "ocean-waves", "gentle-thunder", "library-ambience"
]

MODE_PRESETS = {
    "focus": {"eq_bias": [0.3, 0.4, 0.5, 0.3, 0.2, 0.1, 0.1], "preferred_bed": "brown-noise"},
    "calm": {"eq_bias": [0.5, 0.4, 0.3, 0.2, 0.1, 0.1, 0.05], "preferred_bed": "rain"},
    "creative": {"eq_bias": [0.2, 0.3, 0.4, 0.5, 0.4, 0.3, 0.2], "preferred_bed": "cafe"},
    "social": {"eq_bias": [0.1, 0.2, 0.3, 0.5, 0.5, 0.4, 0.3], "preferred_bed": "white-noise"},
}


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
                "temperature": 0.3,
                "max_tokens": 300,
            },
            timeout=15,
        )
        if response.status_code == 200:
            return response.json()["choices"][0]["message"]["content"]
    except Exception:
        pass
    return ""


def compute_intervention(
    goal_mode: str,
    current_db: float,
    current_bands: list[float],
    cognitive_state: str,
    profile_json: str,
) -> dict:
    """Use ASI1-Mini to reason about the best acoustic intervention."""

    # Parse user profile if available
    profile = None
    if profile_json:
        try:
            profile = json.loads(profile_json)
        except json.JSONDecodeError:
            pass

    preset = MODE_PRESETS.get(goal_mode, MODE_PRESETS["focus"])
    target_eq = profile["eq_gains"] if profile else preset["eq_bias"]
    target_db = profile["optimal_db"] if profile else 50

    # Compute gap analysis
    bands = []
    for i in range(7):
        current = current_bands[i] if i < len(current_bands) else 0
        target = target_eq[i] if i < len(target_eq) else 0
        bands.append({
            "band": BAND_LABELS[i],
            "current": round(current, 3),
            "target": round(target, 3),
            "delta": round(target - current, 3),
        })

    # ASI1-Mini reasoning for bed selection
    system_prompt = """You are Residue's Intervention Agent. Given the user's current acoustic state, 
cognitive state, goal mode, and optimal profile, recommend the best ambient sound bed and explain why.

Available beds: brown-noise, pink-noise, white-noise, rain, cafe, binaural, forest, ocean-waves, 
gentle-thunder, library-ambience.

Respond in valid JSON:
{
  "bed_selection": "one of the available beds",
  "reasoning": "Brief explanation of why this bed helps achieve the goal",
  "volume_adjustment": "increase" | "decrease" | "maintain"
}"""

    current_desc = ", ".join(f"{BAND_LABELS[i]}: {current_bands[i]:.2f}" if i < len(current_bands) else f"{BAND_LABELS[i]}: 0" for i in range(7))
    target_desc = ", ".join(f"{BAND_LABELS[i]}: {target_eq[i]:.2f}" for i in range(7))

    user_prompt = f"""Current state:
- Cognitive state: {cognitive_state}
- Goal: {goal_mode}
- Current dB: {current_db:.1f}, Target dB: {target_db}
- Current EQ: {current_desc}
- Target EQ: {target_desc}
- Has learned profile: {"yes" if profile else "no"}

What ambient bed should be applied?"""

    asi_result = call_asi1_mini(system_prompt, user_prompt)

    bed_selection = preset["preferred_bed"]
    reasoning = f"Default {goal_mode} preset selected."

    if asi_result:
        try:
            if "```json" in asi_result:
                asi_result = asi_result.split("```json")[1].split("```")[0].strip()
            elif "```" in asi_result:
                asi_result = asi_result.split("```")[1].split("```")[0].strip()
            parsed = json.loads(asi_result)
            if parsed.get("bed_selection") in BED_OPTIONS:
                bed_selection = parsed["bed_selection"]
            reasoning = parsed.get("reasoning", reasoning)
        except (json.JSONDecodeError, KeyError):
            pass

    volume_target = max(0, min(1, (target_db - current_db + 50) / 100))

    return {
        "goal_mode": goal_mode,
        "bed_selection": bed_selection,
        "eq_profile": [round(t, 3) for t in target_eq],
        "volume_target": round(volume_target, 3),
        "reasoning": reasoning,
        "gap_analysis": {
            "current_db": current_db,
            "target_db": target_db,
            "delta": round(target_db - current_db, 1),
            "bands": bands,
        },
    }


# ── Agent Setup ──────────────────────────────────────────────────────────────

def create_agent():
    AGENT_PORT = int(os.environ.get("INTERVENTION_AGENT_PORT", "8772"))
    AGENT_SEED = os.environ.get("INTERVENTION_AGENT_SEED", "residue-intervention-agent-seed-phrase-v1")
    AGENTVERSE_API_KEY = os.environ.get("AGENTVERSE_API_KEY", "").strip()

    agent_kwargs = {
        "name": "residue_intervention_agent",
        "port": AGENT_PORT,
        "seed": AGENT_SEED,
        "publish_agent_details": True,
    }
    if AGENTVERSE_API_KEY:
        agent_kwargs["mailbox"] = True

    _agent = Agent(**agent_kwargs)
    protocol = Protocol(spec=chat_protocol_spec)

    print(f"InterventionAgent address: {_agent.address}")

    @_agent.on_event("startup")
    async def startup(ctx: Context):
        ctx.logger.info(f"InterventionAgent started on port {AGENT_PORT}")
        ctx.logger.info(f"Address: {_agent.address}")

    @_agent.on_message(InterventionRequest)
    async def handle_intervention(ctx: Context, sender: str, msg: InterventionRequest):
        ctx.logger.info(f"Intervention request from {sender}: goal={msg.goal_mode}, state={msg.cognitive_state}")

        result = compute_intervention(
            msg.goal_mode,
            msg.current_db,
            msg.current_bands,
            msg.cognitive_state,
            msg.user_profile_json,
        )

        response = InterventionResponse(
            session_id=msg.session_id,
            goal_mode=result["goal_mode"],
            bed_selection=result["bed_selection"],
            eq_profile=result["eq_profile"],
            volume_target=result["volume_target"],
            reasoning=result["reasoning"],
            gap_analysis_json=json.dumps(result["gap_analysis"]),
        )

        await ctx.send(sender, response)
        ctx.logger.info(f"Sent intervention: {result['bed_selection']} at {result['volume_target']:.0%} volume")

    @protocol.on_message(ChatMessage)
    async def handle_chat_message(ctx: Context, sender: str, msg: ChatMessage):
        await ctx.send(
            sender,
            ChatAcknowledgement(timestamp=datetime.now(), acknowledged_msg_id=msg.msg_id),
        )

        text = ""
        for item in msg.content:
            if isinstance(item, TextContent):
                text += item.text

        try:
            payload = json.loads(text)
            if payload.get("action") == "intervene":
                result = compute_intervention(
                    payload.get("goal_mode", "focus"),
                    float(payload.get("current_db", 50)),
                    payload.get("current_bands", [0] * 7),
                    payload.get("cognitive_state", "idle"),
                    json.dumps(payload.get("user_profile", {}))
                    if payload.get("user_profile")
                    else "",
                )
                response_text = json.dumps({"action": "intervene_result", "result": result})
            else:
                response_text = (
                    "I am the Intervention Agent. Send `{\"action\":\"intervene\", ...}` with "
                    "goal_mode/current_db/current_bands/cognitive_state to get an acoustic intervention."
                )
        except (json.JSONDecodeError, TypeError, ValueError):
            response_text = (
                "I am the Intervention Agent. I translate goal mode + current cognitive/acoustic state "
                "into a concrete sound bed, target EQ profile, and volume recommendation."
            )

        await ctx.send(
            sender,
            ChatMessage(
                timestamp=datetime.utcnow(),
                msg_id=uuid4(),
                content=[
                    TextContent(type="text", text=response_text),
                    EndSessionContent(type="end-session"),
                ],
            ),
        )

    @protocol.on_message(ChatAcknowledgement)
    async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
        _ = (ctx, sender, msg)
        return

    _agent.include(protocol, publish_manifest=True)

    return _agent


if __name__ == "__main__":
    agent = create_agent()
    agent.run()
