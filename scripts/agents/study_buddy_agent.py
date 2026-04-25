"""
Residue — Study Buddy Agent (ASI:One + Agentverse + Chat Protocol)

Each Study Buddy agent represents one user and their acoustic profile.
When contacted by the Gateway Agent (or another Study Buddy agent),
it shares its profile and computes compatibility scores.

This enables real agent-to-agent negotiation through Agentverse:
  Gateway → Study Buddy A: "Share your profile for matching"
  Study Buddy A → Study Buddy B: "Here's my profile, what's our compatibility?"
  Study Buddy B → Study Buddy A: "87% compatible — we both prefer low-freq ~50dB"

Run two instances with different seeds to simulate two users:
    BUDDY_ROLE=user  python scripts/agents/study_buddy_agent.py
    BUDDY_ROLE=peer  python scripts/agents/study_buddy_agent.py

Environment:
    ASI1_API_KEY    — ASI:One API key (required)
    BUDDY_ROLE      — "user" or "peer" (determines profile + port)
    BUDDY_SEED      — Custom seed phrase (optional)
"""

import os
import json
import math
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


# ── Role-Based Configuration ─────────────────────────────────────────────────

BUDDY_ROLE = os.environ.get("BUDDY_ROLE", "user")

# Each role has a different identity, port, and acoustic profile
ROLE_CONFIGS = {
    "user": {
        "name": "residue-buddy-user",
        "seed": os.environ.get("BUDDY_USER_SEED", "residue-study-buddy-user-agent-v2"),
        "port": int(os.environ.get("BUDDY_USER_PORT", "8781")),
        "display_name": "Your Study Buddy Agent",
        "profile": {
            "user_id": "user-1",
            "name": "You (Current User)",
            "location": "UCLA Campus",
            "optimal_db": 48.0,
            "db_range": [42, 55],
            "eq_gains": [0.3, 0.5, 0.6, 0.4, 0.3, 0.2, 0.1],
            "preferred_bands": ["Low-Mid (200-500Hz)", "Mid (500-2kHz)"],
            "study_hours": "9am-5pm",
            "preferred_sounds": ["brown noise", "rain", "cafe ambience"],
            "focus_score_avg": 72,
        },
    },
    "peer": {
        "name": "residue-buddy-peer",
        "seed": os.environ.get("BUDDY_PEER_SEED", "residue-study-buddy-peer-agent-v2"),
        "port": int(os.environ.get("BUDDY_PEER_PORT", "8782")),
        "display_name": "Peer Study Buddy Agent",
        "profile": {
            "user_id": "user-2",
            "name": "Alex K.",
            "location": "UCLA Library",
            "optimal_db": 52.0,
            "db_range": [45, 58],
            "eq_gains": [0.4, 0.6, 0.5, 0.3, 0.2, 0.15, 0.1],
            "preferred_bands": ["Low-Mid (200-500Hz)", "Mid (500-2kHz)"],
            "study_hours": "10am-6pm",
            "preferred_sounds": ["pink noise", "rain", "forest sounds"],
            "focus_score_avg": 78,
        },
    },
}

config = ROLE_CONFIGS.get(BUDDY_ROLE, ROLE_CONFIGS["user"])
MY_PROFILE = config["profile"]


# ── Agent Setup ──────────────────────────────────────────────────────────────

agent = Agent(
    name=config["name"],
    seed=config["seed"],
    port=config["port"],
    mailbox=True,
    publish_agent_details=True,
)

protocol = Protocol(spec=chat_protocol_spec)

# Track known peer agents for direct agent-to-agent matching
KNOWN_PEERS: dict[str, dict] = {}


# ── Compatibility Computation ─────────────────────────────────────────────────

def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two EQ vectors."""
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


def compute_compatibility(my_profile: dict, their_profile: dict) -> dict:
    """Compute compatibility between two acoustic profiles."""
    # EQ vector similarity (7 bands)
    eq_sim = cosine_similarity(
        my_profile.get("eq_gains", []),
        their_profile.get("eq_gains", []),
    )

    # dB range overlap
    my_range = my_profile.get("db_range", [40, 60])
    their_range = their_profile.get("db_range", [40, 60])
    overlap = max(0, min(my_range[1], their_range[1]) - max(my_range[0], their_range[0]))
    total_range = max(my_range[1] - my_range[0], their_range[1] - their_range[0], 1)
    db_overlap = overlap / total_range

    # Shared preferred sounds
    my_sounds = set(my_profile.get("preferred_sounds", []))
    their_sounds = set(their_profile.get("preferred_sounds", []))
    sound_overlap = len(my_sounds & their_sounds) / max(len(my_sounds | their_sounds), 1)

    # Weighted compatibility score
    score = (eq_sim * 0.5) + (db_overlap * 0.3) + (sound_overlap * 0.2)

    return {
        "compatibility_score": round(score, 3),
        "eq_similarity": round(eq_sim, 3),
        "db_overlap": round(db_overlap, 3),
        "sound_preference_overlap": round(sound_overlap, 3),
        "shared_sounds": list(my_sounds & their_sounds),
        "shared_bands": list(
            set(my_profile.get("preferred_bands", []))
            & set(their_profile.get("preferred_bands", []))
        ),
    }


async def get_asi1_compatibility_reasoning(
    my_profile: dict, their_profile: dict, scores: dict
) -> str:
    """Use ASI1-Mini to generate a natural-language explanation of compatibility."""
    try:
        r = client.chat.completions.create(
            model="asi1-mini",
            messages=[
                {"role": "system", "content": (
                    "You are a Study Buddy matching agent. Two students' acoustic profiles "
                    "have been compared. Explain in 2-3 sentences WHY they are compatible "
                    "(or not), referencing specific acoustic preferences. Be friendly and specific."
                )},
                {"role": "user", "content": (
                    f"Student A: {json.dumps(my_profile)}\n"
                    f"Student B: {json.dumps(their_profile)}\n"
                    f"Scores: {json.dumps(scores)}"
                )},
            ],
            max_tokens=200,
            temperature=0.4,
        )
        return str(r.choices[0].message.content)
    except Exception:
        return (f"Compatibility score: {scores['compatibility_score']:.0%}. "
                f"Shared preferences: {', '.join(scores.get('shared_sounds', ['none']))}.")


# ── Chat Protocol Handler ────────────────────────────────────────────────────

@protocol.on_message(ChatMessage)
async def handle_message(ctx: Context, sender: str, msg: ChatMessage):
    ctx.logger.info(f"Message from {sender}")

    # Acknowledge
    await ctx.send(
        sender,
        ChatAcknowledgement(timestamp=datetime.now(), acknowledged_msg_id=msg.msg_id),
    )

    # Extract text
    text = ""
    for item in msg.content:
        if isinstance(item, TextContent):
            text += item.text

    # Try to parse as structured agent message
    try:
        parsed = json.loads(text)
        action = parsed.get("action", "")

        if action == "match_request":
            # Gateway is asking us to participate in matching
            ctx.logger.info("Received match request from gateway")
            match_id = parsed.get("match_id", "")
            gateway_addr = parsed.get("gateway_address", sender)

            # If we know peer agents, initiate agent-to-agent matching
            peer_results = {}
            for peer_addr, peer_data in KNOWN_PEERS.items():
                if peer_addr != sender:
                    # Send our profile to the peer agent for comparison
                    profile_msg = ChatMessage(
                        timestamp=datetime.utcnow(),
                        msg_id=uuid4(),
                        content=[TextContent(
                            type="text",
                            text=json.dumps({
                                "action": "compare_profiles",
                                "match_id": match_id,
                                "requester_profile": MY_PROFILE,
                                "requester_address": str(agent.address),
                            })
                        )],
                    )
                    try:
                        await ctx.send(peer_addr, profile_msg)
                        ctx.logger.info(f"Sent profile to peer {peer_addr[:20]}... for comparison")
                    except Exception as e:
                        ctx.logger.error(f"Failed to reach peer {peer_addr[:20]}: {e}")

            # Also compute compatibility with known peer profiles locally
            for peer_addr, peer_data in KNOWN_PEERS.items():
                scores = compute_compatibility(MY_PROFILE, peer_data.get("profile", {}))
                reasoning = await get_asi1_compatibility_reasoning(
                    MY_PROFILE, peer_data.get("profile", {}), scores
                )
                peer_results[peer_addr] = {
                    "peer_name": peer_data.get("profile", {}).get("name", "Unknown"),
                    "peer_location": peer_data.get("profile", {}).get("location", "Unknown"),
                    **scores,
                    "reasoning": reasoning,
                }

            # If no peers known, return our own profile for the gateway to work with
            if not peer_results:
                peer_results["self"] = {
                    "role": BUDDY_ROLE,
                    "profile": MY_PROFILE,
                    "status": "ready_to_match",
                    "message": "Profile shared. Waiting for peer agents to respond.",
                }

            # Respond to gateway with results
            response = ChatMessage(
                timestamp=datetime.utcnow(),
                msg_id=uuid4(),
                content=[TextContent(
                    type="text",
                    text=json.dumps({
                        "action": "match_response",
                        "match_id": match_id,
                        "agent_role": BUDDY_ROLE,
                        "agent_address": str(agent.address),
                        "my_profile": MY_PROFILE,
                        "peer_results": peer_results,
                    })
                )],
            )
            await ctx.send(gateway_addr, response)
            ctx.logger.info(f"Sent match response to gateway")
            return

        elif action == "compare_profiles":
            # Another buddy agent is asking us to compare profiles
            ctx.logger.info("Received profile comparison request from peer agent")
            match_id = parsed.get("match_id", "")
            their_profile = parsed.get("requester_profile", {})
            requester_addr = parsed.get("requester_address", sender)

            # Compute compatibility
            scores = compute_compatibility(MY_PROFILE, their_profile)
            reasoning = await get_asi1_compatibility_reasoning(
                MY_PROFILE, their_profile, scores
            )

            # Send result back
            response = ChatMessage(
                timestamp=datetime.utcnow(),
                msg_id=uuid4(),
                content=[TextContent(
                    type="text",
                    text=json.dumps({
                        "action": "compare_response",
                        "match_id": match_id,
                        "agent_role": BUDDY_ROLE,
                        "my_profile": MY_PROFILE,
                        **scores,
                        "reasoning": reasoning,
                    })
                )],
            )
            await ctx.send(requester_addr, response)
            ctx.logger.info(
                f"Sent comparison result to {requester_addr[:20]}... "
                f"(compatibility: {scores['compatibility_score']:.0%})"
            )
            return

        elif action == "compare_response":
            # Got a comparison result back from a peer
            ctx.logger.info(
                f"Received comparison from peer: "
                f"compatibility={parsed.get('compatibility_score', 0):.0%}"
            )
            # Store for future reference
            KNOWN_PEERS[sender] = {
                "profile": parsed.get("my_profile", {}),
                "last_compatibility": parsed.get("compatibility_score", 0),
            }
            return

        elif action == "register_peer":
            # Gateway or another agent is telling us about a peer
            peer_addr = parsed.get("peer_address", "")
            peer_profile = parsed.get("peer_profile", {})
            if peer_addr:
                KNOWN_PEERS[peer_addr] = {"profile": peer_profile}
                ctx.logger.info(f"Registered peer: {peer_addr[:20]}...")

                response = ChatMessage(
                    timestamp=datetime.utcnow(),
                    msg_id=uuid4(),
                    content=[TextContent(
                        type="text",
                        text=json.dumps({
                            "action": "peer_registered",
                            "status": "ok",
                            "known_peers": len(KNOWN_PEERS),
                        })
                    )],
                )
                await ctx.send(sender, response)
            return

    except (json.JSONDecodeError, TypeError):
        pass

    # Natural language query (from ASI:One or direct user)
    ctx.logger.info(f"Natural language query: {text[:80]}...")

    response_text = ""
    try:
        r = client.chat.completions.create(
            model="asi1-mini",
            messages=[
                {"role": "system", "content": (
                    f"You are a Study Buddy agent representing {MY_PROFILE.get('name', 'a student')}. "
                    f"Your acoustic profile: optimal {MY_PROFILE.get('optimal_db', 50)} dB, "
                    f"preferred sounds: {', '.join(MY_PROFILE.get('preferred_sounds', []))}. "
                    f"You study at {MY_PROFILE.get('location', 'unknown')}. "
                    f"You are part of a multi-agent system where you can negotiate compatibility "
                    f"with other Study Buddy agents. "
                    f"Known peers: {len(KNOWN_PEERS)}. "
                    f"Answer questions about your acoustic preferences and study habits."
                )},
                {"role": "user", "content": text},
            ],
            max_tokens=512,
            temperature=0.4,
        )
        response_text = str(r.choices[0].message.content)
    except Exception as e:
        response_text = (
            f"I'm the {config['display_name']} for {MY_PROFILE.get('name', 'a student')}. "
            f"I prefer studying at {MY_PROFILE.get('optimal_db', 50)} dB with "
            f"{', '.join(MY_PROFILE.get('preferred_sounds', []))}. "
            f"Error reaching ASI1-Mini: {str(e)[:50]}"
        )

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
    ctx.logger.info(f"{config['display_name']} (ASI:One Compatible)")
    ctx.logger.info(f"Role: {BUDDY_ROLE}")
    ctx.logger.info(f"Address: {agent.address}")
    ctx.logger.info(f"Port: {config['port']}")
    ctx.logger.info(f"Profile: {MY_PROFILE.get('name')} @ {MY_PROFILE.get('location')}")
    ctx.logger.info(f"Optimal dB: {MY_PROFILE.get('optimal_db')}")
    ctx.logger.info(f"ASI1-Mini: {'configured' if ASI1_API_KEY else 'NOT configured'}")
    ctx.logger.info(f"Mailbox: enabled (Agentverse)")
    ctx.logger.info("=" * 60)


if __name__ == "__main__":
    print(f"\nResidue Study Buddy Agent — {config['display_name']}")
    print(f"{'='*55}")
    print(f"Role: {BUDDY_ROLE}")
    print(f"Agent address: {agent.address}")
    print(f"Port: {config['port']}")
    print(f"Profile: {MY_PROFILE.get('name')} @ {MY_PROFILE.get('location')}")
    print(f"ASI1-Mini: {'configured' if ASI1_API_KEY else 'NOT configured'}")
    print(f"{'='*55}\n")

    agent.run()
