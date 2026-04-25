# Testing Residue — Acoustic Intelligence Platform

## Devin Secrets Needed

- `ELEVENLABS_API_KEY` — ElevenLabs API key (or `EXPO_PUBLIC_ELEVENLABS_API_KEY`)
- `ELEVENLABS_VOICE_ID` — ElevenLabs voice ID (or `EXPO_PUBLIC_ELEVENLABS_VOICE_ID`)
- `MONGODB_URI` — MongoDB Atlas connection string
- `ASI1_API_KEY` — Fetch.ai ASI1-Mini LLM API key
- `AGENTVERSE_API_KEY` — Fetch.ai Agentverse API key

All secrets go in `.env` at project root (gitignored). The app reads from `.env`, not `.env.local`.

## Running the App

```bash
npm install
npm run dev  # → http://localhost:3000
```

Build check: `npm run build`

## Running Python Agents (for Fetch.ai testing)

```bash
pip install -r scripts/requirements.txt
python scripts/agents/run_all.py          # All agents
python scripts/agents/residue_chat_agent.py  # Chat agent for Agentverse
```

Orchestrator HTTP API runs on port 8765.

## Key Testing Paths

### ElevenLabs AI Bed Generation
- **UI path:** Acoustic Overlay section → "AI Personalized Bed" button (purple gradient with ElevenLabs badge)
- **API:** `POST /api/beds/generate` with `{userId, profile: {eqGains, targetDb}, mode, count}`
- **What to verify:** Spinner during generation (5-15s), green "Playing" indicator, SFX prompt displayed below button, Stop Overlay button works
- **Caching:** Second click may use cached bed (instant) if profile hasn't changed (cosine distance < 0.15). Prompt will say "Using cached personalized bed" instead of a full SFX description.
- **Common issue:** If `ELEVENLABS_API_KEY` is missing, the prompt area shows "Error: ELEVENLABS_API_KEY is required"

### MongoDB Session Persistence
- **UI trigger:** Requires BOTH `acousticProfile` (from mic FFT) AND `currentSnapshot` to be truthy (`page.tsx:77`). Without a mic, the POST to `/api/session` never fires from the frontend.
- **Workaround:** Test the API pipeline directly via curl:
  ```bash
  # Store
  curl -X POST http://localhost:3000/api/session -H 'Content-Type: application/json' \
    -d '{"userId":"test","mode":"focus","acoustic_features":{"overallDb":50,"frequencyBands":[0.3,0.4,0.5,0.4,0.3,0.2,0.1],"dominantFrequency":440,"spectralCentroid":1200},"productivity_score":75,"state":"focused","goal":"focus"}'
  
  # Retrieve
  curl 'http://localhost:3000/api/session?userId=test'
  ```
- **What to verify:** POST returns `stored: true`, GET returns `status: "ok"` with `stats`, `productivityByHour`, `recentSessions`

### Vector Search (Similar Moments)
- **API:** `POST /api/similar-moments` with `{userId, frequencyBands}` (7-dim array)
- **What to verify:** `similarMoments` array with `similarity` scores in [0,1], `prediction` object with `predictedScore`/`confidence`/`dominantState`, `vectorDimensions: 7`
- **Prerequisite:** Must have session data stored first (via Test 2 above)

### Volume Slider Stale Closure Fix
- **How to test:** Click AI Personalized Bed, then drag volume slider during generation. After generation completes, verify volume didn't snap back to 30%.
- **Code:** `useAudioOverlay.ts` uses `volumeRef` and functional `setOverlayState` updates to avoid stale closures.

## Environment Constraints

- **No microphone:** The test VM has no mic, so `acousticProfile` is never populated. This means:
  - MongoDB session persistence from UI cannot be triggered
  - Acoustic Environment panel shows "Enable microphone to see frequency analysis"
  - Correlation engine never fires
  - Test the API pipeline directly instead
- **Screen tracking:** Works but requires selecting a tab to share in the Chrome screen share dialog. Select "New Tab" and click "Share".

## Architecture Notes

- Frontend: Next.js 16 / React 19 / TypeScript
- Audio: Web Audio API with AudioContext, GainNode, MediaElementSource
- Session persistence: fire-and-forget POST on `currentSnapshot` change
- ElevenLabs: `SfxClient.ts` calls `https://api.elevenlabs.io/v1/sound-generation`
- MongoDB: Time-series collection `sessions_ts` with `timeField: "timestamp"`, `metaField: "user_id"`
- Vector search: Manual cosine similarity fallback if Atlas Vector Search index not available
