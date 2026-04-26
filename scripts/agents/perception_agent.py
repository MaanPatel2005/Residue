"""
Residue — PerceptionAgent (Fetch.ai uAgents + ASI1-Mini)

Receives acoustic + behavioral telemetry from the web client,
uses ASI1-Mini to infer cognitive state with natural-language reasoning,
and broadcasts state-change events to the orchestrator.

Privacy: Only timing/magnitude data is processed — never keystroke content.
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

class AcousticData(Model):
    overall_db: float
    frequency_bands: list[float]  # 7-band magnitudes
    spectral_centroid: float
    dominant_frequency: float

class BehavioralData(Model):
    typing_speed: float       # WPM
    error_rate: float          # backspaces/min
    inter_key_latency: float   # ms
    mouse_jitter: float        # px deviation
    scroll_velocity: float     # px/s
    focus_switch_rate: float   # switches/min

class PerceptionRequest(Model):
    session_id: str
    acoustic: Optional[str] = None   # JSON-serialized AcousticData
    behavioral: Optional[str] = None # JSON-serialized BehavioralData
    goal_mode: str = "focus"

class PerceptionResponse(Model):
    session_id: str
    cognitive_state: str         # focused | distracted | idle | transitioning
    confidence: float
    reasoning: str               # ASI1-Mini explanation
    recommendation: str          # what intervention to consider


# ── ASI1-Mini Integration ────────────────────────────────────────────────────

ASI1_API_URL = "https://api.asi1.ai/v1/chat/completions"

def call_asi1_mini(system_prompt: str, user_prompt: str) -> str:
    api_key = os.environ.get("ASI1_API_KEY", "")
    if not api_key:
        return "ASI1-Mini not configured. Using rule-based fallback."

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
            data = response.json()
            return data["choices"][0]["message"]["content"]
    except Exception as e:
        return f"ASI1-Mini error: {str(e)}"
    return "ASI1-Mini request failed."


def infer_cognitive_state(acoustic_json: Optional[str], behavioral_json: Optional[str], goal_mode: str) -> dict:
    """Use ASI1-Mini to infer cognitive state from sensor data."""

    system_prompt = """You are Residue's Perception Agent — an AI that analyzes acoustic environment 
and behavioral telemetry to infer a user's cognitive state. You are part of a multi-agent system 
for personalized acoustic biofeedback.

Given acoustic data (dB level, frequency bands) and behavioral data (typing speed, error rate, 
mouse jitter, focus switching), determine the user's cognitive state.

Respond in valid JSON with exactly these fields:
{
  "cognitive_state": "focused" | "distracted" | "idle" | "transitioning",
  "confidence": 0.0 to 1.0,
  "reasoning": "Brief explanation of why you inferred this state",
  "recommendation": "What acoustic intervention would help achieve the goal mode"
}"""

    acoustic_info = "No acoustic data available."
    if acoustic_json:
        try:
            a = json.loads(acoustic_json)
            acoustic_info = f"Acoustic: {a.get('overall_db', 0):.1f} dB, frequency bands (7-band): {a.get('frequency_bands', [])}, spectral centroid: {a.get('spectral_centroid', 0):.0f} Hz"
        except json.JSONDecodeError:
            pass

    behavioral_info = "No behavioral data available."
    if behavioral_json:
        try:
            b = json.loads(behavioral_json)
            behavioral_info = (
                f"Behavioral: typing {b.get('typing_speed', 0):.0f} WPM, "
                f"error rate {b.get('error_rate', 0):.1f}/min, "
                f"inter-key latency {b.get('inter_key_latency', 0):.0f} ms, "
                f"mouse jitter {b.get('mouse_jitter', 0):.1f} px, "
                f"scroll velocity {b.get('scroll_velocity', 0):.0f} px/s, "
                f"focus switches {b.get('focus_switch_rate', 0):.1f}/min"
            )
        except json.JSONDecodeError:
            pass

    user_prompt = f"""Analyze this user's current state. Their goal is: {goal_mode}

{acoustic_info}
{behavioral_info}

Determine their cognitive state and suggest an acoustic intervention."""

    result = call_asi1_mini(system_prompt, user_prompt)

    try:
        # Try to extract JSON from the response
        if "```json" in result:
            result = result.split("```json")[1].split("```")[0].strip()
        elif "```" in result:
            result = result.split("```")[1].split("```")[0].strip()
        parsed = json.loads(result)
        return {
            "cognitive_state": parsed.get("cognitive_state", "idle"),
            "confidence": min(max(float(parsed.get("confidence", 0.5)), 0), 1),
            "reasoning": parsed.get("reasoning", ""),
            "recommendation": parsed.get("recommendation", ""),
        }
    except (json.JSONDecodeError, KeyError, IndexError):
        # Fallback: rule-based inference
        return rule_based_inference(acoustic_json, behavioral_json)


def rule_based_inference(acoustic_json: Optional[str], behavioral_json: Optional[str]) -> dict:
    """Fallback rule-based cognitive state inference."""
    if not behavioral_json:
        return {"cognitive_state": "idle", "confidence": 0.3, "reasoning": "No behavioral data", "recommendation": "Start a session to begin tracking"}

    try:
        b = json.loads(behavioral_json)
    except json.JSONDecodeError:
        return {"cognitive_state": "idle", "confidence": 0.2, "reasoning": "Invalid data", "recommendation": ""}

    typing_speed = b.get("typing_speed", 0)
    error_rate = b.get("error_rate", 0)
    jitter = b.get("mouse_jitter", 0)
    focus_switches = b.get("focus_switch_rate", 0)

    if typing_speed < 2 and jitter < 1:
        return {"cognitive_state": "idle", "confidence": 0.6, "reasoning": "Minimal input activity", "recommendation": "Consider starting an activity"}
    if focus_switches > 8 or (error_rate > 10 and jitter > 15):
        return {"cognitive_state": "distracted", "confidence": 0.7, "reasoning": "High switching/errors", "recommendation": "Try brown noise to reduce distractions"}
    if typing_speed > 15 and error_rate < 5 and focus_switches < 3:
        return {"cognitive_state": "focused", "confidence": 0.8, "reasoning": "Steady input, low errors", "recommendation": "Maintain current acoustic environment"}
    return {"cognitive_state": "transitioning", "confidence": 0.5, "reasoning": "Mixed signals", "recommendation": "Light ambient sound may help settle focus"}


# ── Agent Setup ──────────────────────────────────────────────────────────────

def create_agent():
    AGENT_PORT = int(os.environ.get("PERCEPTION_AGENT_PORT", "8770"))
    AGENT_SEED = os.environ.get("PERCEPTION_AGENT_SEED", "residue-perception-agent-seed-phrase-v1")
    AGENTVERSE_API_KEY = os.environ.get("AGENTVERSE_API_KEY", "").strip()

    agent_kwargs = {
        "name": "residue_perception_agent",
        "port": AGENT_PORT,
        "seed": AGENT_SEED,
        "publish_agent_details": True,
    }
    if AGENTVERSE_API_KEY:
        agent_kwargs["mailbox"] = True
    

    _agent = Agent(
        **agent_kwargs,
    )
    protocol = Protocol(spec=chat_protocol_spec)

    print(f"PerceptionAgent address: {_agent.address}")

    @_agent.on_event("startup")
    async def startup(ctx: Context):
        ctx.logger.info(f"PerceptionAgent started on port {AGENT_PORT}")
        ctx.logger.info(f"Address: {_agent.address}")

    @_agent.on_message(PerceptionRequest)
    async def handle_perception(ctx: Context, sender: str, msg: PerceptionRequest):
        ctx.logger.info(f"Perception request from {sender} for session {msg.session_id}")

        result = infer_cognitive_state(msg.acoustic, msg.behavioral, msg.goal_mode)

        response = PerceptionResponse(
            session_id=msg.session_id,
            cognitive_state=result["cognitive_state"],
            confidence=result["confidence"],
            reasoning=result["reasoning"],
            recommendation=result["recommendation"],
        )

        await ctx.send(sender, response)
        ctx.logger.info(f"Sent perception: {result['cognitive_state']} ({result['confidence']:.0%} confidence)")

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

        # Optional structured chat path for agent-to-agent usage.
        try:
            payload = json.loads(text)
            if payload.get("action") == "perceive":
                result = infer_cognitive_state(
                    payload.get("acoustic"),
                    payload.get("behavioral"),
                    payload.get("goal_mode", "focus"),
                )
                response_text = json.dumps(
                    {
                        "action": "perceive_result",
                        "cognitive_state": result["cognitive_state"],
                        "confidence": result["confidence"],
                        "reasoning": result["reasoning"],
                        "recommendation": result["recommendation"],
                    }
                )
            else:
                response_text = (
                    "I am the Perception Agent. Send `{\"action\":\"perceive\", ...}` with acoustic/behavioral "
                    "JSON payloads, or ask a natural-language question about cognitive-state inference."
                )
        except (json.JSONDecodeError, TypeError):
            response_text = (
                "I am the Perception Agent. I infer cognitive state from acoustic and behavioral telemetry "
                "(focused/distracted/idle/transitioning) and recommend the next acoustic intervention."
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
