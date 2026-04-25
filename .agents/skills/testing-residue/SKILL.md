# Testing Residue MVP

## Overview
Residue is a Next.js 16 + React 19 web app for personalized acoustic intelligence. The dashboard is a single page at `/` with multiple interactive sections.

## Running the Dev Server
```bash
cd /home/ubuntu/repos/Residue
npm install
npm run dev
# Server runs on http://localhost:3000
```

## Build Verification
```bash
npm run build
# Should complete with no errors
```

## What to Test

### 1. Page Load & Layout
- Navigate to localhost:3000
- Verify all sections render: header ("Residue" title), mode selector (4 modes), Acoustic Environment, Acoustic Overlay (6 sound types), Productivity Tracker, Study Buddy Finder (5 mock users), Your Acoustic Profile (empty state), On-Device Processing badges, Powered By tech badges
- Check browser console for runtime errors

### 2. Mode Selector
- Click each mode (Focus, Calm, Creative, Social)
- Verify only one mode is highlighted (cyan border) at a time
- Focus should be selected by default

### 3. Audio Overlay Controls
- Click any sound type button (e.g., "Brown Noise") to start playback
- Verify green "Playing" indicator and "Stop Overlay" button appear
- Adjust volume slider — percentage text should update in real-time
- Click a different sound type — highlight should switch, only one active
- Click "Stop Overlay" — indicator, button, and highlights should disappear
- Note: Audio overlay uses Web Audio API synthesis (no external APIs needed)

### 4. Start/End Session
- Click "Start Session" button
- If mic is available: button changes to "End Session" (red), timer appears and increments, frequency visualizer starts
- If mic is NOT available: session may still start (known behavior — `startListening()` catch block doesn't re-throw). Timer works but no frequency data collected.
- Click "End Session" to verify it reverts to "Start Session" and timer disappears

### 5. Screen Tracking (Productivity Tracker)
- Click "Start Screen Tracking" — browser will show screen share permission dialog
- Select a screen/tab and click "Share"
- Verify: scores appear (Current Score, Avg Score, Screen Activity), live capture thumbnail visible, session timeline shows snapshot bars
- Test self-report focus rating (1-5 buttons)
- Click "Stop Tracking" to end

### 6. Study Buddy Finder
- 5 mock buddies should load automatically (~1.5s after page load)
- Click "Refresh" to reload — should show spinner then buddies reappear
- Verify sorted by match percentage (highest first)
- Some buddies show green online dot (currentlyStudying: true)

### 7. Correlation Dashboard
- With no data: shows "Collecting data... (0/3 samples needed)" with progress bar at 0%
- Requires both mic + screen tracking active to generate correlations
- After 3+ data points, should show optimal dB range and productivity histogram

## Browser API Requirements
- **Microphone** (`getUserMedia`): Required for acoustic environment analysis. May fail in headless or device-less environments with `NotFoundError: Requested device not found`
- **Screen Capture** (`getDisplayMedia`): Required for productivity tracking. Needs user gesture + permission dialog
- **Web Audio API** (`AudioContext`): Required for audio overlay synthesis. Generally available in all modern browsers

## Known Environment Constraints
- In environments without a physical microphone, "Start Session" will log a console error but the session still starts (timer runs, UI updates). The frequency visualizer remains empty.
- Screen capture requires an interactive browser with display — won't work in fully headless mode
- Audio overlay works independently of microphone access

## Devin Secrets Needed
No secrets are required for basic testing. The app works entirely client-side.

Optional integrations that would need secrets:
- `MONGODB_URI` — MongoDB Atlas connection string for data persistence
- `ELEVENLABS_API_KEY` — ElevenLabs API key for higher-fidelity audio generation
