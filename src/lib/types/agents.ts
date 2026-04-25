import type { AcousticProfile } from '@/types';

// ── Behavioral Feature Vector ───────────────────────────────────────────────
export interface BehavioralFeatureVector {
  typingSpeed: number;       // WPM, rolling 30s window
  errorRate: number;         // backspace frequency per minute
  interKeyLatency: number;   // mean ms between keystrokes
  mouseJitter: number;       // deviation from smoothed path (px)
  scrollVelocity: number;    // px/s, rolling average
  focusSwitchRate: number;   // window focus switches per minute
  timestamp: number;
}

// ── Agent Message Protocol (uAgents-compatible) ─────────────────────────────
export interface AgentMessage<T = unknown> {
  sender: string;
  recipient: string;
  type: string;
  payload: T;
  timestamp: number;
  correlationId?: string;
}

// ── Agent Addresses ─────────────────────────────────────────────────────────
export const AGENT_ADDRESSES = {
  perception: 'agent://residue/perception',
  correlation: 'agent://residue/correlation',
  intervention: 'agent://residue/intervention',
  matching: 'agent://residue/matching',
} as const;

export type AgentAddress = (typeof AGENT_ADDRESSES)[keyof typeof AGENT_ADDRESSES];

// ── Perception Agent ────────────────────────────────────────────────────────
export interface PerceptionState {
  acoustic: AcousticProfile | null;
  behavioral: BehavioralFeatureVector | null;
  cognitiveState: CognitiveState;
  confidence: number;
  timestamp: number;
}

export type CognitiveState = 'focused' | 'distracted' | 'idle' | 'transitioning';

export interface StateChangeEvent {
  previous: CognitiveState;
  current: CognitiveState;
  acoustic: AcousticProfile | null;
  behavioral: BehavioralFeatureVector | null;
  timestamp: number;
}

// ── Correlation Agent ───────────────────────────────────────────────────────
export interface CorrelationUpdate {
  userId: string;
  optimalProfile: OptimalAcousticProfile;
  dataPoints: number;
  lastUpdated: number;
}

export interface OptimalAcousticProfile {
  targetDb: number;
  dbRange: [number, number];
  eqGains: number[];   // 7-band EQ gain vector
  preferredBands: string[];
  confidence: number;
}

// ── Intervention Agent ──────────────────────────────────────────────────────
export interface InterventionCommand {
  goalMode: 'focus' | 'calm' | 'creative' | 'social';
  eqProfile: number[];   // 7-band target EQ
  bedSelection: string;
  bedUrl: string | null;
  volumeTarget: number;
  gapAnalysis: {
    currentDb: number;
    targetDb: number;
    delta: number;
    bands: { band: string; current: number; target: number; delta: number }[];
  };
  timestamp: number;
}

// ── Matching Agent ──────────────────────────────────────────────────────────
export interface MatchRequest {
  userId: string;
  eqVector: number[];
  location?: { lat: number; lng: number };
  radiusKm?: number;
  activeOnly?: boolean;
}

export interface MatchResult {
  userId: string;
  name: string;
  similarity: number;
  optimalDbRange: [number, number];
  eqVector: number[];
  location?: string;
  currentlyStudying: boolean;
  lastActive: number;
}

// ── Window globals for cross-agent communication ────────────────────────────
declare global {
  interface Window {
    __residueAcoustic?: AcousticProfile;
    __residueBehavior?: BehavioralFeatureVector;
    __residueIntervention?: InterventionCommand;
    __residuePerception?: PerceptionState;
  }
}

export {};
