# Residue Multi-Agent Architecture

## Agents with Acoustic Environment as a First-Class Context Type

Residue introduces a new class of environmental context agents. Unlike traditional agent systems that operate on text or structured data, Residue's agents perceive, reason about, and respond to the **physical acoustic environment** as a native input type. This is the first agent framework where ambient sound is treated as a first-class context signal.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (Client-side, low-latency)                              │
│                                                                  │
│  ┌─────────────────┐    ┌──────────────────────┐                │
│  │ BehaviorTracker  │    │ AudioCapture (Agent A)│                │
│  │ (keystroke, mouse,│    │ (FFT, dB, frequency   │                │
│  │  focus tracking)  │    │  bands)               │                │
│  └────────┬─────────┘    └──────────┬────────────┘                │
│           │                         │                             │
│           ▼                         ▼                             │
│  window.__residueBehavior   window.__residueAcoustic              │
│           │                         │                             │
│           └────────┬────────────────┘                             │
│                    ▼                                              │
│           ┌────────────────────┐                                  │
│           │ PerceptionAgent    │ ← Infers cognitive state from    │
│           │ (10Hz polling)     │   acoustic + behavioral signals  │
│           └────────┬───────────┘                                  │
│                    │ state-change events                          │
│                    ▼                                              │
│           ┌────────────────────┐                                  │
│           │ InterventionAgent  │ ← Computes EQ gap + bed         │
│           │                    │   selection for goal mode        │
│           └────────┬───────────┘                                  │
│                    │                                              │
│                    ▼                                              │
│           window.__residueIntervention → Agent A's BedPlayer      │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Server (Next.js API routes + Python service)                    │
│                                                                  │
│  ┌──────────────────────┐    ┌──────────────────────┐           │
│  │ CorrelationAgent     │    │ MatchingAgent         │           │
│  │ /api/agents/correlation│    │ /api/agents/matching  │           │
│  │                      │    │ + scripts/matching_    │           │
│  │ • Consumes session   │    │   agent.py (uAgents)  │           │
│  │   data from MongoDB  │    │                      │           │
│  │ • Updates user's     │    │ • Cosine similarity   │           │
│  │   acoustic-to-state  │    │   over EQ vectors    │           │
│  │   model              │    │ • Location filtering  │           │
│  │ • Runs on 5-min      │    │ • Fetch.ai Agentverse│           │
│  │   interval + on      │    │   registration       │           │
│  │   demand             │    │                      │           │
│  └──────────────────────┘    └──────────────────────┘           │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ MongoDB Atlas                                             │   │
│  │ • Time-series collection (sessions_ts)                    │   │
│  │ • Vector index on 7-dim EQ embeddings                     │   │
│  │ • Profile storage with Bayesian posteriors                │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

## Agent Roles

### PerceptionAgent (Client-side)
- **Input**: `window.__residueAcoustic` (from Agent A) + `window.__residueBehavior` (from BehaviorTracker)
- **Output**: `window.__residuePerception` with cognitive state (focused/distracted/idle/transitioning)
- **Frequency**: 10 Hz polling
- **Novel capability**: Acoustic environment is a first-class context type for state inference

### CorrelationAgent (Server-side)
- **Input**: Session data from MongoDB
- **Output**: Updated optimal acoustic profile (EQ gains, target dB, preferred bands)
- **Frequency**: 5-minute interval + on-demand
- **Novel capability**: Builds a personal acoustic-to-state model over time

### InterventionAgent (Client-side)
- **Input**: Current perception state + optimal profile from CorrelationAgent
- **Output**: `window.__residueIntervention` with EQ profile + bed selection
- **Novel capability**: Closed-loop actuator that shapes the acoustic environment

### MatchingAgent (Server-side + Python uAgents)
- **Input**: User's EQ vector + location
- **Output**: Ranked study buddies by acoustic profile similarity
- **Novel capability**: Social matching based on learned acoustic preferences

## Inter-Agent Communication

All agents communicate via typed messages following the Fetch.ai uAgents protocol:

```typescript
interface AgentMessage<T> {
  sender: string;      // "agent://residue/perception"
  recipient: string;   // "agent://residue/correlation"
  type: string;        // "state_change" | "correlation_update" | ...
  payload: T;
  timestamp: number;
  correlationId?: string;
}
```

Client-side agents use `window.__residue*` globals for zero-latency communication.
Server-side agents use Next.js API routes and MongoDB for persistence.
The MatchingAgent additionally implements the full uAgents protocol for Fetch.ai Agentverse integration.

## Privacy Guarantees

- All behavioral data is captured as **timing metrics only** — never content
- Acoustic analysis runs entirely on-device (Web Audio API FFT)
- Screen content is never transmitted; only change detection scores
- The on-device processing story satisfies the ZETIC sponsor requirement
