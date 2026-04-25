# MatchingAgent — Fetch.ai uAgents Service

## Overview

The MatchingAgent is a Python service implementing the Fetch.ai uAgents protocol
for study buddy matching. It computes cosine similarity over users' learned
acoustic EQ vectors and returns ranked matches filtered by location and activity.

## Quick Start

```bash
cd scripts/
pip install -r requirements.txt
python matching_agent.py
```

The agent runs on two ports:
- **Port 8765**: HTTP fallback (always available)
- **Port 8766**: uAgents protocol (Fetch.ai native)

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | No | MongoDB connection string. Falls back to demo profiles if unset. |
| `AGENTVERSE_API_KEY` | No | Fetch.ai Agentverse API key for cross-network discovery. |
| `MATCHING_AGENT_PORT` | No | HTTP port (default: 8765). uAgents runs on port+1. |

## Agentverse Registration

To register the agent on Fetch.ai Agentverse:

1. Create an account at https://agentverse.ai
2. Get your API key from the dashboard
3. Set `AGENTVERSE_API_KEY` in `.env.local`
4. Start the agent — it will auto-register

Without the API key, the agent runs locally and is accessible via the HTTP API
and the Next.js proxy at `/api/agents/matching`.

## API

### POST /match

Request:
```json
{
  "userId": "user-123",
  "eqVector": [0.3, 0.4, 0.5, 0.4, 0.3, 0.2, 0.1],
  "lat": 34.0689,
  "lng": -118.4452,
  "radiusKm": 50,
  "activeOnly": false
}
```

Response:
```json
[
  {
    "userId": "demo-alex",
    "name": "Alex K.",
    "similarity": 0.9821,
    "optimalDbRange": [40, 55],
    "eqVector": [0.3, 0.4, 0.5, 0.4, 0.3, 0.2, 0.1],
    "location": "UCLA Library",
    "currentlyStudying": true,
    "lastActive": 1714000000000
  }
]
```

## uAgents Message Format

The agent handles `MatchRequest` messages and responds with `MatchResponse`:

```python
class MatchRequest(Model):
    user_id: str
    eq_vector: list[float]
    lat: float | None
    lng: float | None
    radius_km: float = 50.0
    active_only: bool = False

class MatchResponse(Model):
    matches: list[dict]
    source: str = "uagents"
```

## Integration with Next.js

The Next.js API route at `/api/agents/matching` proxies requests to this service
when `AGENTVERSE_API_KEY` is set. If the Python service is unavailable, it falls
back to the TypeScript implementation in `src/lib/agents/MatchingAgent.ts`.
