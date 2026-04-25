"""
Residue — Gateway Agent (ASI:One + Agentverse + Chat Protocol)

The user-facing entry point for Residue's multi-agent acoustic intelligence
system. This agent:
  1. Receives natural-language queries from users via ASI:One Chat
  2. Coordinates with Study Buddy agents for matching requests
  3. Uses ASI1-Mini for acoustic analysis and recommendations

All inter-agent communication uses the Chat Protocol (ChatMessage)
through Agentverse mailboxes — real agent-to-agent messaging.

Requirements:
    pip install uagents openai python-dotenv

Environment:
    ASI1_API_KEY          — ASI:One API key (required)
    AGENTVERSE_API_KEY    — Agentverse API key (for mailbox)
    BUDDY_AGENT_ADDRESSES — Comma-separated study buddy agent addresses

Usage:
    python scripts/agents/gateway_agent.py
"""

import os
import json
import asyncio
from datetime import datetime
from uuid import uuid4
from pathlib import Path

# Load .env from project root
project_root = Path(__file__).parent.parent.parent
env_file = project_root / ".env"
if env_file.exists():
    from dotenv import load_dotenv
    load_dotenv(env_file)

from openai import OpenAI
from uagents import Context, Protocol, Agent
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    TextContent,
    chat_protocol_spec,
)


# ── ASI1-Mini Client ─────────────────────────────────────────────────────────

ASI1_API_KEY = os.environ.get("ASI1_API_KEY", "")

client = OpenAI(
    base_url="https://api.asi1.ai/v1",
    api_key=ASI1_API_KEY,
)


# ── Agent Configuration ──────────────────────────────────────────────────────

AGENT_SEED = os.environ.get(
    "GATEWAY_AGENT_SEED",
    "residue-gateway-agent-asi-one-v2"
)
AGENT_PORT = int(os.environ.get("GATEWAY_AGENT_PORT", "8780"))

agent = Agent(
    name="residue-gateway",
    seed=AGENT_SEED,
    port=AGENT_PORT,
    mailbox=True,
    publish_agent_details=True,
)

# Study buddy agent addresses (populated at startup or from env)
BUDDY_ADDRESSES: list[str] = []
_raw = os.environ.get("BUDDY_AGENT_ADDRESSES", "")
if _raw:
    BUDDY_ADDRESSES = [a.strip() for a in _raw.split(",") if a.strip()]

# Chat protocol
protocol = Protocol(spec=chat_protocol_spec)

# Track pending buddy matching requests
pending_matches: dict[str, dict] = {}


# ── System Prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are Residue's Gateway Agent — the primary interface for a personalized 
acoustic intelligence platform. You are part of a real multi-agent system built with the 
Fetch.ai uAgents framework, where agents communicate through Agentverse mailboxes.

Your architecture:
- YOU (Gateway Agent): Handle user queries, coordinate other agents
- Study Buddy Agent A: Represents the current user's acoustic profile
- Study Buddy Agent B: Represents potential study partners

When users ask about study buddy matching, you coordinate the Study Buddy agents 
to negotiate compatibility scores via real agent-to-agent ChatMessages.

Your domain expertise:
1. ACOUSTIC ANALYSIS: Analyze environments (dB levels, 7-band EQ from Sub-bass 20-60Hz 
   through Brilliance 6-20kHz) and explain effects on cognitive states.

2. COGNITIVE STATE INFERENCE: Given behavioral data (typing speed, error rate, mouse jitter, 
   focus switching), infer focus/distraction/idle/transitioning states.

3. PERSONALIZED RECOMMENDATIONS: Recommend optimal soundscapes (brown noise, pink noise, 
   white noise, rain, cafe ambience, binaural beats, forest sounds, ocean waves).

4. STUDY BUDDY MATCHING: Coordinate Study Buddy agents to find compatible study partners 
   based on acoustic profile similarity.

Key facts about Residue:
- All audio/screen processing happens ON-DEVICE (privacy-first)
- Uses 7 frequency bands for acoustic profiling
- Tracks behavioral signals: typing speed, error rate, inter-key latency, mouse jitter
- Never captures keystroke CONTENT, only timing
- MongoDB Atlas for time-series data and vector search
- ElevenLabs for generative ambient bed synthesis
- Built with Next.js 16 + React 19 + TypeScript

Always be helpful, specific, and data-driven. You are a domain expert in personalized 
acoustic biofeedback."""


# ── Intent Detection ─────────────────────────────────────────────────────────

def detect_intent(text: str) -> str:
    """Classify user intent to decide whether to involve other agents."""
    lower = text.lower()
    buddy_keywords = ["buddy", "partner", "match", "study with", "find someone",
                       "compatible", "study group", "pair", "connect with"]
    if any(kw in lower for kw in buddy_keywords):
        return "study_buddy"
    return "general"


# ── Study Buddy Coordination ─────────────────────────────────────────────────

async def coordinate_buddy_matching(ctx: Context, user_query: str) -> str:
    """
    Coordinate Study Buddy agents to find a match.
    
    Sends ChatMessages to each buddy agent asking them to share their profile
    and compute compatibility. This is real agent-to-agent communication
    through Agentverse.
    """
    if not BUDDY_ADDRESSES:
        return ("I don't have any Study Buddy agents connected right now. "
                "Please make sure the Study Buddy agents are running and their "
                "addresses are configured.")

    match_id = str(uuid4())[:8]
    pending_matches[match_id] = {
        "query": user_query,
        "responses": {},
        "expected": len(BUDDY_ADDRESSES),
    }

    # Send matching request to each buddy agent via ChatMessage
    for addr in BUDDY_ADDRESSES:
        match_msg = ChatMessage(
            timestamp=datetime.utcnow(),
            msg_id=uuid4(),
            content=[TextContent(
                type="text",
                text=json.dumps({
                    "action": "match_request",
                    "match_id": match_id,
                    "query": user_query,
                    "gateway_address": str(agent.address),
                })
            )],
        )
        try:
            await ctx.send(addr, match_msg)
            ctx.logger.info(f"Sent match request to buddy agent: {addr[:20]}...")
        except Exception as e:
            ctx.logger.error(f"Failed to contact buddy agent {addr[:20]}: {e}")
            pending_matches[match_id]["responses"][addr] = {
                "error": str(e),
                "status": "unreachable",
            }

    # Wait for buddy responses (with timeout)
    for _ in range(30):  # 30 * 0.5s = 15s timeout
        await asyncio.sleep(0.5)
        match_data = pending_matches.get(match_id, {})
        if len(match_data.get("responses", {})) >= match_data.get("expected", 0):
            break

    # Compile results
    match_data = pending_matches.pop(match_id, {})
    responses = match_data.get("responses", {})

    if not responses:
        return ("I sent matching requests to Study Buddy agents but haven't received "
                "responses yet. The agents may need more time or might not be running.")

    # Use ASI1-Mini to summarize the matching results
    results_text = json.dumps(responses, indent=2)
    try:
        r = client.chat.completions.create(
            model="asi1-mini",
            messages=[
                {"role": "system", "content": (
                    "You are summarizing study buddy matching results from a multi-agent system. "
                    "Each Study Buddy agent has compared acoustic profiles and returned compatibility data. "
                    "Summarize the results in a friendly, helpful way. Mention compatibility scores, "
                    "shared acoustic preferences, and recommend the best match."
                )},
                {"role": "user", "content": f"User asked: {user_query}\n\nAgent responses:\n{results_text}"},
            ],
            max_tokens=512,
            temperature=0.4,
        )
        return str(r.choices[0].message.content)
    except Exception:
        # Fallback: return raw results
        return f"Study Buddy matching results:\n{results_text}"


# ── Chat Protocol Handler ────────────────────────────────────────────────────

@protocol.on_message(ChatMessage)
async def handle_message(ctx: Context, sender: str, msg: ChatMessage):
    ctx.logger.info(f"Chat message from {sender}")

    # Acknowledge receipt
    await ctx.send(
        sender,
        ChatAcknowledgement(timestamp=datetime.now(), acknowledged_msg_id=msg.msg_id),
    )

    # Extract text
    text = ""
    for item in msg.content:
        if isinstance(item, TextContent):
            text += item.text

    # Check if this is a buddy agent response (not a user query)
    try:
        parsed = json.loads(text)
        if parsed.get("action") == "match_response":
            match_id = parsed.get("match_id", "")
            if match_id in pending_matches:
                pending_matches[match_id]["responses"][sender] = parsed
                ctx.logger.info(f"Received match response from {sender[:20]}...")
                return  # Don't reply to agent responses
    except (json.JSONDecodeError, TypeError):
        pass

    ctx.logger.info(f"User query: {text[:100]}...")

    # Detect intent
    intent = detect_intent(text)
    ctx.logger.info(f"Detected intent: {intent}")

    if intent == "study_buddy":
        # Coordinate with Study Buddy agents
        ctx.logger.info("Coordinating study buddy matching...")
        response_text = await coordinate_buddy_matching(ctx, text)
    else:
        # General query — use ASI1-Mini directly
        response_text = (
            "I apologize, but I'm having trouble processing your request right now. "
            "Please try again in a moment."
        )
        try:
            # Include buddy agent info in context
            buddy_info = ""
            if BUDDY_ADDRESSES:
                buddy_info = f"\n\nYou have {len(BUDDY_ADDRESSES)} Study Buddy agents connected: {', '.join(a[:15] + '...' for a in BUDDY_ADDRESSES)}"

            r = client.chat.completions.create(
                model="asi1-mini",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT + buddy_info},
                    {"role": "user", "content": text},
                ],
                max_tokens=1024,
                temperature=0.4,
            )
            response_text = str(r.choices[0].message.content)
        except Exception as e:
            ctx.logger.exception(f"Error querying ASI1-Mini: {e}")

    # Send response
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
    ctx.logger.info("Response sent")


@protocol.on_message(ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    ctx.logger.info(f"Ack from {sender} for {msg.acknowledged_msg_id}")


# Attach protocol
agent.include(protocol, publish_manifest=True)


@agent.on_event("startup")
async def on_startup(ctx: Context):
    ctx.logger.info("=" * 60)
    ctx.logger.info("Residue Gateway Agent (ASI:One Compatible)")
    ctx.logger.info(f"Address: {agent.address}")
    ctx.logger.info(f"Port: {AGENT_PORT}")
    ctx.logger.info(f"ASI1-Mini: {'configured' if ASI1_API_KEY else 'NOT configured'}")
    ctx.logger.info(f"Buddy agents: {len(BUDDY_ADDRESSES)} configured")
    for addr in BUDDY_ADDRESSES:
        ctx.logger.info(f"  - {addr}")
    ctx.logger.info(f"Mailbox: enabled (Agentverse)")
    ctx.logger.info("=" * 60)


if __name__ == "__main__":
    print(f"\nResidue Gateway Agent — ASI:One Chat Interface")
    print(f"{'='*55}")
    print(f"Agent address: {agent.address}")
    print(f"Port: {AGENT_PORT}")
    print(f"ASI1-Mini: {'configured' if ASI1_API_KEY else 'NOT configured'}")
    print(f"Buddy agents: {len(BUDDY_ADDRESSES)}")
    print(f"{'='*55}")
    print(f"\nTo register on Agentverse:")
    print(f"  1. Start this agent")
    print(f"  2. Click the inspector link in the logs")
    print(f"  3. Create a mailbox for the agent")
    print(f"  4. Chat via https://asi1.ai/chat\n")

    agent.run()
