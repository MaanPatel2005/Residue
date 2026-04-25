"""
Residue — OrchestratorAgent (Fetch.ai uAgents + ASI1-Mini)

Central coordinator that routes messages between the specialized agents.
This is the entry point for the web client — it receives high-level
requests and orchestrates the multi-agent pipeline:

  Client → Orchestrator → PerceptionAgent → Orchestrator
                        → CorrelationAgent → Orchestrator
                        → InterventionAgent → Client

Also provides an HTTP API so the Next.js frontend can communicate
with the agent system without running a uAgents client.

For the Fetch.ai Cognition pitch: This demonstrates agents with acoustic
environment awareness as a first-class context type.
"""

import os
import sys
import json
import asyncio
import threading
import time
import requests as http_requests
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from dotenv import load_dotenv
from uagents import Agent, Context, Model
from typing import Optional

# Load .env from project root so ASI1_API_KEY and other secrets are available
_project_root = Path(__file__).parent.parent.parent
load_dotenv(_project_root / ".env")

# Ensure sibling agent modules are importable
sys.path.insert(0, str(Path(__file__).parent.resolve()))


# ── Shared Message Models (must match other agents) ─────────────────────────

class PerceptionRequest(Model):
    session_id: str
    acoustic: Optional[str] = None
    behavioral: Optional[str] = None
    goal_mode: str = "focus"

class PerceptionResponse(Model):
    session_id: str
    cognitive_state: str
    confidence: float
    reasoning: str
    recommendation: str

class CorrelationRequest(Model):
    user_id: str
    sessions: str

class CorrelationResponse(Model):
    user_id: str
    optimal_db: float
    db_range: list[float]
    eq_gains: list[float]
    preferred_bands: list[str]
    confidence: float
    insight: str
    data_points: int

class InterventionRequest(Model):
    session_id: str
    goal_mode: str
    current_db: float
    current_bands: list[float]
    cognitive_state: str
    user_profile_json: str

class InterventionResponse(Model):
    session_id: str
    goal_mode: str
    bed_selection: str
    eq_profile: list[float]
    volume_target: float
    reasoning: str
    gap_analysis_json: str

class OrchestrateRequest(Model):
    """High-level request from the web client."""
    session_id: str
    user_id: str
    goal_mode: str
    acoustic_json: str
    behavioral_json: str
    sessions_json: str  # historical session data for correlation

class FindMatchesRequest(Model):
    user_id: str
    top_k: int = 5

class FindMatchesResponse(Model):
    user_id: str
    matches_json: str

class OrchestrateResponse(Model):
    """Combined response from the multi-agent pipeline."""
    session_id: str
    cognitive_state: str
    confidence: float
    perception_reasoning: str
    bed_selection: str
    eq_profile: list[float]
    volume_target: float
    intervention_reasoning: str
    correlation_insight: str
    correlation_confidence: float


# ── ASI1-Mini for orchestration decisions ────────────────────────────────────

ASI1_API_URL = "https://api.asi1.ai/v1/chat/completions"

def call_asi1_mini(system_prompt: str, user_prompt: str) -> str:
    api_key = os.environ.get("ASI1_API_KEY", "")
    if not api_key:
        return ""
    try:
        response = http_requests.post(
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
                "max_tokens": 200,
            },
            timeout=15,
        )
        if response.status_code == 200:
            return response.json()["choices"][0]["message"]["content"]
    except Exception:
        pass
    return ""


# ── Agent Setup ──────────────────────────────────────────────────────────────

AGENT_PORT = int(os.environ.get("ORCHESTRATOR_AGENT_PORT", "8773"))
AGENT_SEED = os.environ.get("ORCHESTRATOR_AGENT_SEED", "residue-orchestrator-agent-seed-phrase-v1")

# Agent addresses (populated at startup or from env)
PERCEPTION_ADDRESS = os.environ.get("PERCEPTION_AGENT_ADDRESS", "")
CORRELATION_ADDRESS = os.environ.get("CORRELATION_AGENT_ADDRESS", "")
INTERVENTION_ADDRESS = os.environ.get("INTERVENTION_AGENT_ADDRESS", "")

agent = Agent(
    name="residue_orchestrator",
    port=AGENT_PORT,
    seed=AGENT_SEED,
    endpoint=[f"http://localhost:{AGENT_PORT}/submit"],
)

print(f"OrchestratorAgent address: {agent.address}")

# Store pending responses (written by async agent handlers, read by HTTP thread)
pending_responses: dict[str, dict] = {}
_pending_lock = threading.Lock()


@agent.on_event("startup")
async def startup(ctx: Context):
    ctx.logger.info(f"OrchestratorAgent started on port {AGENT_PORT}")
    ctx.logger.info(f"Address: {agent.address}")
    ctx.logger.info(f"Perception: {PERCEPTION_ADDRESS}")
    ctx.logger.info(f"Correlation: {CORRELATION_ADDRESS}")
    ctx.logger.info(f"Intervention: {INTERVENTION_ADDRESS}")


@agent.on_message(OrchestrateRequest)
async def handle_orchestrate(ctx: Context, sender: str, msg: OrchestrateRequest):
    """Orchestrate the full perception → correlation → intervention pipeline."""
    ctx.logger.info(f"Orchestration request from {sender}: session={msg.session_id}")

    # Initialize response tracking
    with _pending_lock:
        pending_responses[msg.session_id] = {
            "sender": sender,
            "user_id": msg.user_id,
            "goal_mode": msg.goal_mode,
            "acoustic_json": msg.acoustic_json,
            "behavioral_json": msg.behavioral_json,
            "perception": None,
            "correlation": None,
            "intervention": None,
        }

    # Step 1: Send to PerceptionAgent
    if PERCEPTION_ADDRESS:
        perception_msg = PerceptionRequest(
            session_id=msg.session_id,
            acoustic=msg.acoustic_json if msg.acoustic_json else None,
            behavioral=msg.behavioral_json if msg.behavioral_json else None,
            goal_mode=msg.goal_mode,
        )
        await ctx.send(PERCEPTION_ADDRESS, perception_msg)
        ctx.logger.info("Forwarded to PerceptionAgent")

    # Step 2: Send to CorrelationAgent (in parallel)
    if CORRELATION_ADDRESS and msg.sessions_json:
        correlation_msg = CorrelationRequest(
            user_id=msg.user_id,
            sessions=msg.sessions_json,
        )
        await ctx.send(CORRELATION_ADDRESS, correlation_msg)
        ctx.logger.info("Forwarded to CorrelationAgent")


@agent.on_message(PerceptionResponse)
async def handle_perception_response(ctx: Context, sender: str, msg: PerceptionResponse):
    """Receive perception result and trigger intervention."""
    ctx.logger.info(f"Perception response for session {msg.session_id}: {msg.cognitive_state}")

    with _pending_lock:
        session = pending_responses.get(msg.session_id)
        if not session:
            return
        session["perception"] = {
            "cognitive_state": msg.cognitive_state,
            "confidence": msg.confidence,
            "reasoning": msg.reasoning,
            "recommendation": msg.recommendation,
        }

    # Now trigger InterventionAgent with perception + any correlation data
    if INTERVENTION_ADDRESS:
        acoustic = {}
        if session["acoustic_json"]:
            try:
                acoustic = json.loads(session["acoustic_json"])
            except json.JSONDecodeError:
                pass

        profile_json = ""
        if session.get("correlation"):
            profile_json = json.dumps(session["correlation"])

        intervention_msg = InterventionRequest(
            session_id=msg.session_id,
            goal_mode=session["goal_mode"],
            current_db=acoustic.get("overall_db", 50),
            current_bands=acoustic.get("frequency_bands", [0]*7),
            cognitive_state=msg.cognitive_state,
            user_profile_json=profile_json,
        )
        await ctx.send(INTERVENTION_ADDRESS, intervention_msg)
        ctx.logger.info("Forwarded to InterventionAgent")


@agent.on_message(CorrelationResponse)
async def handle_correlation_response(ctx: Context, sender: str, msg: CorrelationResponse):
    """Receive correlation result."""
    ctx.logger.info(f"Correlation response for user {msg.user_id}: {msg.optimal_db} dB")

    # Find the session for this user and update atomically under lock
    with _pending_lock:
        for session_id, session in pending_responses.items():
            if session.get("user_id") == msg.user_id:
                session["correlation"] = {
                    "optimal_db": msg.optimal_db,
                    "db_range": msg.db_range,
                    "eq_gains": msg.eq_gains,
                    "preferred_bands": msg.preferred_bands,
                    "confidence": msg.confidence,
                    "insight": msg.insight,
                    "data_points": msg.data_points,
                }
                break


@agent.on_message(FindMatchesResponse)
async def handle_find_matches_response(ctx: Context, sender: str, msg: FindMatchesResponse):
    """Receive cross-agent match results from the CorrelationAgent."""
    ctx.logger.info(f"FindMatches response for user {msg.user_id}")
    try:
        matches = json.loads(msg.matches_json or "[]")
    except json.JSONDecodeError:
        matches = []

    # Store keyed by user_id so the HTTP fallback (or polling clients) can
    # retrieve the most recent match results.
    with _pending_lock:
        pending_responses[f"match:{msg.user_id}"] = {
            "complete": True,
            "result": {
                "user_id": msg.user_id,
                "matches": matches,
            },
        }


@agent.on_message(InterventionResponse)
async def handle_intervention_response(ctx: Context, sender: str, msg: InterventionResponse):
    """Receive intervention result and send combined response back to client."""
    ctx.logger.info(f"Intervention response for session {msg.session_id}: {msg.bed_selection}")

    with _pending_lock:
        session = pending_responses.get(msg.session_id)
        if not session:
            return
        session["intervention"] = {
            "bed_selection": msg.bed_selection,
            "eq_profile": msg.eq_profile,
            "volume_target": msg.volume_target,
            "reasoning": msg.reasoning,
            "gap_analysis": msg.gap_analysis_json,
        }

    # Build combined response
    perception = session.get("perception", {})
    correlation = session.get("correlation", {})

    response = OrchestrateResponse(
        session_id=msg.session_id,
        cognitive_state=perception.get("cognitive_state", "idle"),
        confidence=perception.get("confidence", 0),
        perception_reasoning=perception.get("reasoning", ""),
        bed_selection=msg.bed_selection,
        eq_profile=msg.eq_profile,
        volume_target=msg.volume_target,
        intervention_reasoning=msg.reasoning,
        correlation_insight=correlation.get("insight", ""),
        correlation_confidence=correlation.get("confidence", 0),
    )

    if session.get("sender"):
        await ctx.send(session["sender"], response)
        ctx.logger.info(f"Sent orchestrated response to {session['sender']}")

    # Store result for HTTP polling (lock so HTTP thread sees complete atomically)
    with _pending_lock:
        session["complete"] = True
        session["result"] = {
            "session_id": msg.session_id,
            "cognitive_state": perception.get("cognitive_state", "idle"),
            "confidence": perception.get("confidence", 0),
            "perception_reasoning": perception.get("reasoning", ""),
            "bed_selection": msg.bed_selection,
            "eq_profile": msg.eq_profile,
            "volume_target": msg.volume_target,
            "intervention_reasoning": msg.reasoning,
            "correlation_insight": correlation.get("insight", ""),
            "correlation_confidence": correlation.get("confidence", 0),
        }


# ── HTTP API for Next.js Frontend ────────────────────────────────────────────

class OrchestratorHTTPHandler(BaseHTTPRequestHandler):
    """HTTP interface so the Next.js frontend can talk to the agent system."""

    def do_POST(self):
        if self.path == "/orchestrate":
            self._handle_orchestrate()
        elif self.path == "/perceive":
            self._handle_perceive()
        elif self.path == "/correlate":
            self._handle_correlate()
        elif self.path == "/intervene":
            self._handle_intervene()
        elif self.path == "/status":
            self._handle_status()
        elif self.path == "/match":
            self._handle_match()
        else:
            self.send_error(404)

    def do_GET(self):
        if self.path == "/health":
            self._json_response(200, {
                "status": "ok",
                "agent": "residue_orchestrator",
                "address": agent.address,
                "agents": {
                    "perception": PERCEPTION_ADDRESS or "not configured",
                    "correlation": CORRELATION_ADDRESS or "not configured",
                    "intervention": INTERVENTION_ADDRESS or "not configured",
                },
            })
        elif self.path.startswith("/result/"):
            session_id = self.path.split("/result/")[1]
            with _pending_lock:
                session = pending_responses.get(session_id)
            if session and session.get("complete"):
                self._json_response(200, session["result"])
            else:
                self._json_response(202, {"status": "pending"})
        else:
            self.send_error(404)

    def _handle_perceive(self):
        """Direct perception (bypasses orchestration)."""
        body = self._read_body()
        from perception_agent import infer_cognitive_state
        acoustic = body.get("acoustic")
        behavioral = body.get("behavioral")
        if isinstance(acoustic, dict):
            acoustic = json.dumps(acoustic)
        if isinstance(behavioral, dict):
            behavioral = json.dumps(behavioral)
        result = infer_cognitive_state(
            acoustic,
            behavioral,
            body.get("goal_mode", "focus"),
        )
        self._json_response(200, result)

    def _handle_correlate(self):
        """Direct correlation (bypasses orchestration)."""
        body = self._read_body()
        from correlation_agent import build_optimal_profile
        sessions_json = json.dumps(body.get("sessions", []))
        result = build_optimal_profile(sessions_json)
        self._json_response(200, result)

    def _handle_intervene(self):
        """Direct intervention (bypasses orchestration)."""
        body = self._read_body()
        from intervention_agent import compute_intervention
        result = compute_intervention(
            body.get("goal_mode", "focus"),
            body.get("current_db", 50),
            body.get("current_bands", [0]*7),
            body.get("cognitive_state", "idle"),
            json.dumps(body.get("user_profile", {})) if body.get("user_profile") else "",
        )
        self._json_response(200, result)

    def _handle_orchestrate(self):
        """Full orchestration pipeline via HTTP."""
        body = self._read_body()

        # For HTTP mode, run the pipeline synchronously
        from perception_agent import infer_cognitive_state
        from correlation_agent import build_optimal_profile
        from intervention_agent import compute_intervention

        # Step 1: Perception
        acoustic_raw = body.get("acoustic")
        behavioral_raw = body.get("behavioral")
        if isinstance(acoustic_raw, dict):
            acoustic_raw = json.dumps(acoustic_raw)
        if isinstance(behavioral_raw, dict):
            behavioral_raw = json.dumps(behavioral_raw)
        perception = infer_cognitive_state(
            acoustic_raw,
            behavioral_raw,
            body.get("goal_mode", "focus"),
        )

        # Step 2: Correlation (if sessions provided)
        correlation = {}
        if body.get("sessions"):
            correlation = build_optimal_profile(json.dumps(body["sessions"]))

        # Step 3: Intervention
        acoustic = {}
        if body.get("acoustic"):
            try:
                acoustic = json.loads(body["acoustic"])
            except (json.JSONDecodeError, TypeError):
                if isinstance(body["acoustic"], dict):
                    acoustic = body["acoustic"]

        profile_json = json.dumps(correlation) if correlation and "error" not in correlation else ""

        intervention = compute_intervention(
            body.get("goal_mode", "focus"),
            acoustic.get("overall_db", 50) if isinstance(acoustic, dict) else 50,
            acoustic.get("frequency_bands", [0]*7) if isinstance(acoustic, dict) else [0]*7,
            perception.get("cognitive_state", "idle"),
            profile_json,
        )

        result = {
            "perception": perception,
            "correlation": correlation,
            "intervention": intervention,
            "agent_addresses": {
                "orchestrator": agent.address,
                "perception": PERCEPTION_ADDRESS or "local",
                "correlation": CORRELATION_ADDRESS or "local",
                "intervention": INTERVENTION_ADDRESS or "local",
            },
        }

        self._json_response(200, result)

    def _handle_match(self):
        """Find users with similar acoustic profiles via cross-agent matching.

        We always run the synchronous in-process fallback (same pattern as
        _handle_orchestrate, which imports and calls agent functions
        directly). When CORRELATION_ADDRESS is set we additionally check
        pending_responses for a recent agent-routed FindMatchesResponse and
        prefer it — those are populated by the on_message handler when
        another agent (or this orchestrator) sends the CorrelationAgent a
        FindMatchesRequest over the uAgents bus.
        """
        body = self._read_body()
        user_id = body.get("user_id", "")
        top_k = int(body.get("top_k", 5))

        if not user_id:
            self._json_response(400, {"error": "user_id is required"})
            return

        # Synchronous in-process fallback (always safe to run)
        from correlation_agent import find_matches_for_user
        sync_matches = find_matches_for_user(user_id, top_k=top_k)

        agent_matches: Optional[list] = None
        if CORRELATION_ADDRESS:
            with _pending_lock:
                entry = pending_responses.get(f"match:{user_id}")
            if entry and entry.get("complete"):
                agent_matches = entry["result"].get("matches", [])

        result = {
            "user_id": user_id,
            "top_k": top_k,
            "matches": agent_matches if agent_matches is not None else sync_matches,
            "source": "agent" if agent_matches is not None else "sync_fallback",
            "agent_addresses": {
                "orchestrator": agent.address,
                "correlation": CORRELATION_ADDRESS or "local",
            },
        }
        self._json_response(200, result)

    def _handle_status(self):
        body = self._read_body()
        session_id = body.get("session_id", "")
        with _pending_lock:
            session = pending_responses.get(session_id)
        if session and session.get("complete"):
            self._json_response(200, {"status": "complete", "result": session["result"]})
        elif session:
            self._json_response(200, {"status": "pending"})
        else:
            self._json_response(404, {"status": "not_found"})

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length:
            return json.loads(self.rfile.read(length))
        return {}

    def _json_response(self, status: int, data: dict):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        pass  # suppress request logs


HTTP_PORT = int(os.environ.get("ORCHESTRATOR_HTTP_PORT", "8765"))


def run_http_server():
    server = HTTPServer(("0.0.0.0", HTTP_PORT), OrchestratorHTTPHandler)
    print(f"Orchestrator HTTP API running on port {HTTP_PORT}")
    server.serve_forever()


if __name__ == "__main__":
    # Start HTTP server in background thread
    http_thread = threading.Thread(target=run_http_server, daemon=True)
    http_thread.start()

    print(f"\nResidue Multi-Agent System")
    print(f"{'='*50}")
    print(f"Orchestrator uAgent: port {AGENT_PORT}")
    print(f"Orchestrator HTTP:   port {HTTP_PORT}")
    print(f"Agent address:       {agent.address}")
    print(f"{'='*50}\n")

    agent.run()
