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

### Orchestrator (primary — exposes HTTP API)
```bash
python scripts/agents/orchestrator_agent.py
# Starts uAgent on port 8773 + HTTP API on port 8765
```

### All agents (separate processes)
```bash
python scripts/agents/run_all.py
# Starts Perception (8770), Correlation (8771), Intervention (8772), Orchestrator (8773+8765)
```

### Chat agent (Agentverse registration)
```bash
python scripts/agents/residue_chat_agent.py
# Starts on port 8780 with Chat Protocol + mailbox
```

## Key HTTP Endpoints (port 8765)

| Method | Path | Purpose |
|--------|------|--------|
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

1. **ASI1-Mini not activating**: Agent files must call `load_dotenv()` to load `.env`. Without this, `os.environ.get("ASI1_API_KEY")` returns empty and agents silently fall back to rule-based inference.

2. **Port conflicts**: Each agent binds to a unique port. If running orchestrator standalone, it imports agent functions without starting their servers (via `create_agent()` factory pattern). If you see port-in-use errors, check for leftover agent processes.

3. **Data format**: The `/orchestrate` endpoint on port 8765 accepts `acoustic` and `behavioral` as either JSON strings or dicts. The Next.js route at `/api/agents/orchestrate` accepts them as dicts and serializes internally.

4. **Chat agent mailbox**: The chat agent prints a warning about missing mailbox on first run. The user must manually create one at https://agentverse.ai using the agent inspector link printed at startup.
