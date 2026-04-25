# Residue — Personalized Acoustic Intelligence

**AI that learns your optimal acoustic environment and actively shapes it for peak cognitive performance.**

Residue runs passively in the background, sampling your acoustic environment through your microphone while tracking behavioral proxies for your cognitive state. Over time, it builds a personal acoustic-to-state model, learning what specific sound environments make *you* most productive. Once the model is built, Residue actively shapes your acoustic environment — adding, subtracting, and filtering frequencies in real time to push your environment toward your optimal profile.

## What Makes Residue Novel

This is the **first consumer application of personalized acoustic biofeedback**. The research exists — acoustic environments measurably affect cognitive performance — but it has never been operationalized as a personal, learning, on-device AI system. Brain.fm is a content library. **Residue is a closed-loop system that learns and adapts to you specifically.**

## Features

### Acoustic Environment Analysis
- Real-time FFT frequency analysis via Web Audio API
- dB level monitoring with optimal zone detection
- Frequency band breakdown (Sub-bass through Brilliance)
- Spectral centroid and dominant frequency tracking
- All processing happens **on-device** — no audio data leaves your machine

### Productivity Tracking
- **Screenshot-based activity detection**: Periodic screen captures analyzed locally to detect if you're staying on task
- Screen change percentage tracking — if your screen hasn't changed in 20+ minutes, you may not be productive
- Self-report focus ratings (1-5) for model calibration
- Session timeline visualization

### Personalized Acoustic Profile
- Correlates your acoustic environment with your productivity state
- Learns your optimal dB range and frequency profile
- Builds a personal model from as few as 3 data points
- Continuously refines with more data
- Provides confidence-weighted recommendations

### Acoustic Overlay Engine
- 6 synthesized soundscapes: Brown Noise, Pink Noise, White Noise, Rain, Cafe, Binaural Beats
- Volume control and real-time generation via Web Audio API
- AI recommendations based on your learned profile and current environment
- Mode-specific presets (Focus, Calm, Creative, Social)

### Study Buddy Matching
- Find nearby people who study best in similar acoustic environments
- Powered by Fetch.ai multi-agent system
- Acoustic similarity matching based on optimal profiles

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Frontend | Next.js 16 + React 19 + Tailwind CSS | Web application |
| Audio Analysis | Web Audio API (on-device FFT) | Real-time acoustic profiling |
| Screen Tracking | Screen Capture API + Canvas diffing | Productivity inference |
| Data Store | MongoDB Atlas | Longitudinal acoustic-state data |
| Audio Generation | Web Audio API + ElevenLabs | Personalized soundscapes |
| Agent System | Fetch.ai Agentverse | Multi-agent acoustic intelligence |
| On-Device ML | ZETIC Melange | Privacy-preserving inference |

## Track Alignment

- **ZETIC** ($1,000) — All acoustic analysis + screen inference runs entirely on-device
- **Cognition** ($3,000) — Agent with acoustic environment awareness as a first-class input
- **Fetch.ai** ($2,500) — Multi-agent system: acoustic agent, state inference agent, study buddy matching agent
- **ElevenLabs** (earbuds) — Synthesized acoustic environments from learned frequency profiles
- **MongoDB** (M5Stack) — Longitudinal acoustic-to-state correlation dataset
- **Cloudinary** ($500) — Acoustic profile visualization and sharing

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and:

1. Click **Start Session** to begin acoustic monitoring
2. Grant microphone access when prompted
3. Click **Start Screen Tracking** to enable productivity tracking
4. Select your desired cognitive mode (Focus, Calm, Creative, Social)
5. Use the app normally — Residue learns your patterns in the background
6. Check your **Acoustic Profile** as data accumulates
7. Try the **Acoustic Overlay** to hear AI-recommended soundscapes

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Browser (All On-Device)                         │
│  ┌─────────────┐  ┌───────────────────────────┐ │
│  │ Mic Capture  │  │ Screen Capture + Diff     │ │
│  │ (Web Audio)  │  │ (Canvas API, on-device)   │ │
│  └──────┬──────┘  └──────────┬────────────────┘ │
│         │                    │                   │
│  ┌──────▼──────┐            │                   │
│  │ FFT Analyzer│            │                   │
│  │ (on-device) │            │                   │
│  └──────┬──────┘            │                   │
│         └────────┬──────────┘                   │
│          ┌───────▼────────┐                     │
│          │ Correlation    │                     │
│          │ Engine         │                     │
│          └───────┬────────┘                     │
│          ┌───────▼────────┐                     │
│          │ Audio Overlay  │                     │
│          │ (Web Audio)    │                     │
│          └────────────────┘                     │
└─────────────────────────────────────────────────┘
         │              │
    ┌────▼────┐   ┌─────▼──────┐
    │MongoDB  │   │Fetch.ai    │
    │Atlas    │   │Agents      │
    └─────────┘   └────────────┘
```

## Privacy

**All audio and screen data is processed entirely on-device.** No microphone audio, screen captures, or productivity data ever leaves your machine. Only aggregated, anonymized acoustic profiles are stored in MongoDB Atlas for longitudinal analysis. This is a core architectural principle, not a feature toggle.

## License

MIT
