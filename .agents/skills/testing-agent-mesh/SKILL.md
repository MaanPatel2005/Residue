# Testing: Residue Agent Mesh & Dashboard UI

## Overview
Residue uses Fetch.ai uAgents with Chat Protocol for multi-agent communication. The frontend has:
- **AgentPanel**: Displays 4 agent addresses (orchestrator, perception, correlation, intervention) with copy buttons and "Chat on ASI:One" link
- **StudyBuddyFinder**: Lists other users with similarity scores and Connect/Disconnect buttons
- **AgentMatchPanel**: Cross-agent matching via CorrelationAgent

## Devin Secrets Needed
- `ASI1_API_KEY` — Required for "Test Agent Pipeline" button (calls ASI1-Mini)
- `AGENTVERSE_API_KEY` — Required only if starting Python agents
- `MONGODB_URI` — Required for session persistence, buddy connections, user agent data
- `ELEVENLABS_API_KEY` — Required for AI Personalized Bed generation

All secrets go in `.env` at project root (gitignored).

## Auth Setup for Testing

The app uses Auth0 for authentication. If Auth0 env vars (`AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`) are not configured:
- The Auth0 middleware will crash ALL requests with 500 errors
- **Fix**: Add dummy placeholder values to `.env`:
  ```
  AUTH0_DOMAIN=dev-placeholder.us.auth0.com
  AUTH0_CLIENT_ID=placeholder_client_id
  AUTH0_CLIENT_SECRET=placeholder_client_secret
  AUTH0_SECRET=placeholder_secret_for_local_dev_testing_only
  ```
- With dummy values, middleware passes through and the legacy `/api/auth/register` + `/api/auth/login` endpoints work

### Browser Authentication via Playwright CDP
The dashboard is gated behind auth (`if (!auth.user) return <AuthGateHome />`). To authenticate in the browser without real Auth0:

```python
import asyncio, json
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp("http://localhost:29229")
        context = browser.contexts[0]
        page = context.pages[0]
        
        # Login via API
        result = await page.evaluate("""
            async () => {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({email: 'test@test.com', password: 'testpass123'})
                });
                return await res.json();
            }
        """)
        
        auth_response = json.dumps({'token': result['token'], 'user': result['user']})
        await page.route('**/api/auth/me', lambda route: route.fulfill(
            status=200, content_type='application/json', body=auth_response
        ))
        await page.goto('http://localhost:3000')
        await page.wait_for_load_state('networkidle')

asyncio.run(main())
```

Run as a background process to keep the route interception alive across page reloads.

## How to Start the Dev Server
```bash
cd /home/ubuntu/repos/Residue
fuser 3000/tcp 2>/dev/null | xargs kill -9 2>/dev/null
npx next dev -p 3000
```

Note: `lsof` may not be available. Use `fuser` instead.

## Agent Architecture (4 agents per user)

Each user gets 4 agents with unique seeds derived from their userId:
- **Orchestrator** — Coordinates the other agents, answers general questions
- **Perception** — Infers cognitive state from acoustic/behavioral data
- **Correlation** — Builds acoustic profiles, computes buddy compatibility
- **Intervention** — Recommends soundscapes and EQ adjustments

Agent addresses are stored in MongoDB `user_agents` collection, keyed by userId.

## Key Test Endpoints

### GET /api/agents/status
Returns agent addresses and liveness. Uses the 4-agent architecture (orchestrator, perception, correlation, intervention).

### POST /api/agents/orchestrate
"Test Agent Pipeline" button calls this. Two response paths:
1. **Python orchestrator running** (port 8765): Returns flat response
2. **In-process fallback** (no Python): Calls ASI1-Mini directly, returns nested

### Buddy Connection Endpoints (require Bearer token auth)
```bash
# Connect to a buddy
curl -s -X POST http://localhost:3000/api/buddies/connect \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"buddyId":"user-123","buddyName":"Alice"}'

# List connections
curl -s http://localhost:3000/api/buddies/connections \
  -H 'Authorization: Bearer <token>'

# Disconnect
curl -s -X DELETE http://localhost:3000/api/buddies/connect \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"buddyId":"user-123"}'
```

All return `{"error":"unauthenticated"}` with 401 if no valid token.

## What to Test

### StudyBuddyFinder (Connect button flow)
1. **Connect**: Click Connect → button changes to green "Connected" with checkmark → expanded panel shows 4 agent addresses with copy buttons + "Chat on ASI:One" link
2. **Disconnect**: Click Disconnect → button reverts to cyan "Connect", panel collapses
3. **Persistence**: Connect, refresh page → connection persists (loaded from MongoDB on mount)
4. **Auth guard**: All buddy API endpoints return 401 without auth

### AgentPanel UI
1. **Renders correctly**: "Agent Network" header with "Fetch.ai" badge, 4 agent rows with role badges
2. **Copy address**: Click copy icon → checkmark appears
3. **Test Agent Pipeline**: Click → spinner → ASI1-Mini reasoning text
4. **Collapse/expand**: Click header to toggle

## Known Environment Limitations
- **Auth0 middleware**: Crashes all requests without env vars. Use dummy placeholders.
- **Clipboard API**: May be blocked in automated environments
- **Microphone**: Dashboard acoustic analysis requires mic input
- **Python agents**: For UI-only testing, the in-process ASI1-Mini fallback works without Python agents
- **Match percentages**: Show 0% for users without acoustic profile data. This is expected.
