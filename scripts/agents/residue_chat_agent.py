"""
Residue — ASI:One Compatible Chat Agent (Agentverse + Chat Protocol)

This agent implements the Fetch.ai Chat Protocol, making it discoverable
via ASI:One and registerable on Agentverse. It acts as the public-facing
entry point for Residue's multi-agent acoustic intelligence system.

Users can ask natural language questions like:
- "What acoustic environment helps me focus?"
- "Analyze my study session data"
- "Find study buddies near UCLA"
- "What soundscape should I use for creativity?"

The agent uses ASI1-Mini for reasoning and coordinates with the other
Residue agents (Perception, Correlation, Intervention) internally.

Requirements:
    pip install uagents openai python-dotenv

Environment:
    ASI1_API_KEY  — ASI:One API key (required)
    AGENT_SEED    — Unique seed phrase for agent identity

Usage:
    python scripts/agents/residue_chat_agent.py
"""

import os
import json
import sys
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
    "RESIDUE_CHAT_AGENT_SEED",
    "residue-acoustic-intelligence-chat-agent-v1"
)
AGENT_PORT = int(os.environ.get("RESIDUE_CHAT_AGENT_PORT", "8780"))

agent = Agent(
    name="residue-acoustic-intelligence",
    seed=AGENT_SEED,
    port=AGENT_PORT,
    mailbox=True,
    publish_agent_details=True,
)

# Chat protocol
protocol = Protocol(spec=chat_protocol_spec)


# ── System Prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are Residue, a personalized acoustic intelligence AI agent. You are an expert 
in acoustic environments and their effect on cognitive performance. You are part of a multi-agent 
system built with the Fetch.ai uAgents framework.

Your capabilities:
1. ACOUSTIC ANALYSIS: You can analyze acoustic environments (dB levels, frequency bands from 
   Sub-bass 20-60Hz through Brilliance 6-20kHz) and explain how they affect cognitive states.

2. COGNITIVE STATE INFERENCE: Given behavioral data (typing speed, error rate, mouse jitter, 
   focus switching), you can infer whether a user is focused, distracted, idle, or transitioning.

3. PERSONALIZED RECOMMENDATIONS: Based on a user's historical acoustic-productivity correlations, 
   you recommend optimal soundscapes (brown noise, pink noise, white noise, rain, cafe ambience, 
   binaural beats, forest sounds, ocean waves).

4. STUDY BUDDY MATCHING: You can help find study partners with similar acoustic preferences using 
   cosine similarity over 7-band EQ vectors.

5. BAYESIAN PROFILE BUILDING: You explain how Residue builds personalized acoustic profiles 
   using Bayesian posterior updates with confidence intervals.

Key facts about Residue:
- All audio/screen processing happens ON-DEVICE (privacy-first, ZETIC compatible)
- Uses 7 frequency bands for acoustic profiling
- Tracks behavioral signals: typing speed, error rate, inter-key latency, mouse jitter, 
  scroll velocity, focus switch rate
- Never captures keystroke CONTENT, only timing
- Built with Next.js 16 + React 19 + TypeScript + Tailwind CSS
- MongoDB Atlas for time-series data and vector search
- ElevenLabs for generative ambient bed synthesis

When users ask questions:
- If they describe their environment, analyze it and recommend a soundscape
- If they share productivity data, infer their cognitive state
- If they ask about study buddies, explain the matching algorithm
- If they ask general questions about acoustics and focus, share research-backed insights
- Always be helpful, specific, and data-driven in your responses

You are a domain expert in personalized acoustic biofeedback. Stay focused on this domain."""


# ── Chat Protocol Handler ────────────────────────────────────────────────────

@protocol.on_message(ChatMessage)
async def handle_message(ctx: Context, sender: str, msg: ChatMessage):
    ctx.logger.info(f"Chat message from {sender}")

    # Acknowledge receipt
    await ctx.send(
        sender,
        ChatAcknowledgement(timestamp=datetime.now(), acknowledged_msg_id=msg.msg_id),
    )

    # Extract text from message
    text = ""
    for item in msg.content:
        if isinstance(item, TextContent):
            text += item.text

    ctx.logger.info(f"User query: {text[:100]}...")

    # Query ASI1-Mini
    response_text = (
        "I apologize, but I'm having trouble processing your request right now. "
        "Please try again in a moment."
    )
    try:
        r = client.chat.completions.create(
            model="asi1-mini",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
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
    pass


# Attach protocol
agent.include(protocol, publish_manifest=True)


@agent.on_event("startup")
async def on_startup(ctx: Context):
    ctx.logger.info("=" * 60)
    ctx.logger.info("Residue Acoustic Intelligence Agent")
    ctx.logger.info(f"Address: {agent.address}")
    ctx.logger.info(f"Port: {AGENT_PORT}")
    ctx.logger.info(f"ASI1-Mini: {'configured' if ASI1_API_KEY else 'NOT configured'}")
    ctx.logger.info(f"Mailbox: enabled (Agentverse compatible)")
    ctx.logger.info("=" * 60)


if __name__ == "__main__":
    print(f"\nResidue Acoustic Intelligence — ASI:One Chat Agent")
    print(f"{'='*55}")
    print(f"Agent address: {agent.address}")
    print(f"Port: {AGENT_PORT}")
    print(f"ASI1-Mini: {'configured' if ASI1_API_KEY else 'NOT configured'}")
    print(f"{'='*55}")
    print(f"\nTo register on Agentverse:")
    print(f"  1. Go to https://agentverse.ai")
    print(f"  2. Create a mailbox for this agent")
    print(f"  3. The agent will auto-connect\n")

    agent.run()
