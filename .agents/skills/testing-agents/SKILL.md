# Testing Residue Agent System

This skill covers testing the Fetch.ai uAgents + ASI1-Mini multi-agent system.

## Devin Secrets Needed

- `ASI1_API_KEY` — ASI1-Mini LLM key (get from https://asi1.ai/dashboard/api-keys)
- `AGENTVERSE_API_KEY` — Agentverse JWT token (get from https://agentverse.ai)
- `MONGODB_URI` — MongoDB Atlas connection string
- `ELEVENLABS_API_KEY` — ElevenLabs API key

All secrets go in `.env` at project root (gitignored). The agent Python files load this via `load_dotenv()`.

## Prerequisites

```bash
# Install Python dependencies
pip install -r scripts/requirements.txt

# Install Node dependencies
npm install
```

## Starting the Agent System

### Per-user agent launcher (preferred)
```bash
# List all users and their agent keys
python scripts/agents/launch_user_agents.py --list

# Start agents for a specific user
python scripts/agents/launch_user_agents.py maanvpatel@gmail.com

# Start agents for ALL registered users
python scripts/agents/launch_user_agents.py --all
```

The launcher reads unique seeds/ports from MongoDB `user_agents` collection and starts all 4 agents per user.

### Legacy: All agents (separate processes)
```bash
python scripts/agents/run_all.py
# Starts Perception (8770), Correlation (8771), Intervention (8772), Orchestrator (8773+8765)
```

## Agent Architecture (4 agents per user)

Each user gets 4 unique agents with seeds derived from their userId:
- **Orchestrator** (port 8773) — Coordinates pipeline, answers general questions
- **Perception** (port 8770) — Cognitive state inference from acoustic/behavioral data  
- **Correlation** (port 8771) — Profile building, buddy compatibility
- **Intervention** (port 8772) — Soundscape/EQ recommendations

Agents are registered on Agentverse with mailboxes and reachable via ASI:One chat.

## Key HTTP Endpoints (port 8765)

| Method | Path | Purpose |
|--------|------|---------|
| GET | /health | Agent status + addresses |
| POST | /orchestrate | Full pipeline: perception → correlation → intervention |
| POST | /perceive | Perception only (cognitive state inference) |
| POST | /correlate | Correlation only (profile building) |
| POST | /intervene | Intervention only (bed/EQ recommendation) |

## Testing the Pipeline

### Health check
```bash
curl -s http://localhost:8765/health | python3 -m json.tool
# Expect: {"status": "ok", "agent": "residue_orchestrator", "address": "agent1q..."}
```

### Perception test
```bash
curl -s -X POST http://localhost:8765/perceive \
  -H "Content-Type: application/json" \
  -d '{
    "acoustic": {"overall_db": 55, "frequency_bands": [0.3, 0.5, 0.6, 0.4, 0.3, 0.2, 0.1]},
    "behavioral": {"typing_speed": 45, "error_rate": 2, "inter_key_latency": 120, "mouse_jitter": 5, "scroll_velocity": 100, "focus_switch_rate": 1.5},
    "goal_mode": "focus"
  }' | python3 -m json.tool
```

### Full orchestrate test
```bash
curl -s -X POST http://localhost:8765/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "test-1",
    "user_id": "user-1",
    "goal_mode": "focus",
    "acoustic": "{\"overall_db\":55,\"frequency_bands\":[0.3,0.5,0.6,0.4,0.3,0.2,0.1]}",
    "behavioral": "{\"typing_speed\":45,\"error_rate\":2,\"inter_key_latency\":120,\"mouse_jitter\":5,\"scroll_velocity\":100,\"focus_switch_rate\":1.5}"
  }' | python3 -m json.tool
```

## Next.js API Route Testing

```bash
# Start dev server
npm run dev

# Health check (shows python_orchestrator status)
curl -s http://localhost:3000/api/agents/orchestrate | python3 -m json.tool

# Full pipeline via Next.js (proxies to Python or falls back to direct ASI1-Mini)
curl -s -X POST http://localhost:3000/api/agents/orchestrate \
  -H "Content-Type: application/json" \
  -d '{"session_id":"t1","user_id":"u1","goal_mode":"focus","acoustic":{"overall_db":55,"frequency_bands":[0.3,0.5,0.6,0.4,0.3,0.2,0.1]},"behavioral":{"typing_speed":45,"error_rate":2,"inter_key_latency":120,"mouse_jitter":5,"scroll_velocity":100,"focus_switch_rate":1.5}}'
```

The `source` field in the response distinguishes:
- `"uagents"` — proxied to Python orchestrator
- `"asi1-mini-direct"` — fallback (Python service not running)

## How to Verify ASI1-Mini is Working

The critical distinction between ASI1-Mini and rule-based fallback:
- **ASI1-Mini**: `reasoning` field contains detailed, data-specific text (100+ chars) referencing actual input values
- **Rule-based fallback**: `reasoning` is short and generic, e.g. `"Steady input, low errors"` (24 chars)

If you see short generic reasoning, check that `.env` contains `ASI1_API_KEY` and that agent files call `load_dotenv()`.

## Common Issues

1. **Auth0 middleware crashes all requests**: If AUTH0_* env vars are not in `.env`, the Auth0 middleware will return 500 for every request. Add dummy placeholder values (see testing-agent-mesh skill).

2. **ASI1-Mini not activating**: Agent files must call `load_dotenv()` to load `.env`. Without this, `os.environ.get("ASI1_API_KEY")` returns empty and agents silently fall back to rule-based inference.

3. **Port conflicts**: Each agent binds to a unique port. If running orchestrator standalone, it imports agent functions without starting their servers. If you see port-in-use errors, check for leftover agent processes.

4. **Data format**: The `/orchestrate` endpoint on port 8765 accepts `acoustic` and `behavioral` as either JSON strings or dicts. The Next.js route at `/api/agents/orchestrate` accepts them as dicts and serializes internally.

5. **MongoDB connection in agents**: Agents load data from MongoDB via `mongo_loader.py`. If `MONGODB_URI` is missing or `pymongo[srv]` is not installed, agents will print a warning and respond with domain knowledge instead of personalized data.

6. **Dynamic agent provisioning**: New users get unique agent seeds on registration. The seeds are stored in MongoDB `user_agents` collection. Use `launch_user_agents.py` to start agents for specific users.
