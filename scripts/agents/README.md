# Residue Multi-Agent System

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)

Residue's multi-agent system built with [Fetch.ai uAgents](https://github.com/fetchai/uAgents) and [ASI1-Mini](https://asi1.ai).

## Agents

| Agent | File | Port | Purpose |
|-------|------|------|---------|
| PerceptionAgent | `perception_agent.py` | 8770 | Cognitive state inference from acoustic + behavioral data |
| CorrelationAgent | `correlation_agent.py` | 8771 | Personal acoustic profile learning |
| InterventionAgent | `intervention_agent.py` | 8772 | Optimal acoustic intervention computation |
| OrchestratorAgent | `orchestrator_agent.py` | 8773 (uAgent) + 8765 (HTTP) | Pipeline coordination + HTTP API |
| Chat Agent | `residue_chat_agent.py` | 8780 | ASI:One compatible (Agentverse) |

## Quick Start

```bash
# From project root
cd scripts
pip install -r requirements.txt

# Run all agents
python agents/run_all.py

# Or run just the chat agent for Agentverse
python agents/residue_chat_agent.py
```

## Environment Variables

Set these in `.env` at the project root:

```bash
ASI1_API_KEY=your-asi1-mini-api-key      # Required — get at https://asi1.ai/dashboard/api-keys
MONGODB_URI=your-mongodb-connection       # Optional — for profile persistence
AGENTVERSE_API_KEY=your-agentverse-key    # Optional — for Agentverse registration
```

## HTTP API (Orchestrator)

When running `run_all.py`, the orchestrator exposes HTTP on port 8765:

### POST /orchestrate
Full pipeline: perception → correlation → intervention.

```json
{
  "session_id": "abc123",
  "user_id": "user1",
  "goal_mode": "focus",
  "acoustic": "{\"overall_db\": 55, \"frequency_bands\": [0.3, 0.4, 0.5, 0.4, 0.3, 0.2, 0.1]}",
  "behavioral": "{\"typing_speed\": 45, \"error_rate\": 3, \"inter_key_latency\": 120, \"mouse_jitter\": 5, \"scroll_velocity\": 100, \"focus_switch_rate\": 2}"
}
```

### POST /perceive
Cognitive state inference only.

### POST /correlate
Profile building from session history.

### POST /intervene
Acoustic intervention recommendation.

### GET /health
Agent system status.

## Agentverse Registration

The `residue_chat_agent.py` implements the Fetch.ai Chat Protocol, making it discoverable via ASI:One:

1. Run: `python agents/residue_chat_agent.py`
2. Go to [agentverse.ai](https://agentverse.ai) and sign in
3. Create a mailbox for the agent
4. Your agent is now discoverable via ASI:One chat

## Architecture

Each agent uses ASI1-Mini for reasoning rather than hardcoded rules. The perception agent infers cognitive state from raw sensor data, the correlation agent generates insights about your acoustic preferences, and the intervention agent reasons about which soundscape best achieves your goal.
