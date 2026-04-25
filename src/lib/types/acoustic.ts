/**
 * Acoustic-domain shared types.
 *
 * This module is owned by Agent A (real-time DSP / acoustic feature pipeline).
 * Agent B may IMPORT from here; do not edit it from Agent B's scope.
 *
 * Only `export interface` / `export type` declarations belong here. Runtime
 * helpers live in `lib/audio/*` or `lib/dsp/*`.
 */

import type { AcousticProfile } from '@/types';

// ── EQ / DSP contract ───────────────────────────────────────────────────────

export type BiquadFilterKind =
  | 'lowpass'
  | 'highpass'
  | 'bandpass'
  | 'lowshelf'
  | 'highshelf'
  | 'peaking'
  | 'notch'
  | 'allpass';

export interface EQBand {
  /** Filter type as accepted by Web Audio's BiquadFilterNode. */
  type: BiquadFilterKind;
  /** Centre / cutoff frequency in Hz. */
  frequency: number;
  /** Quality factor. Ignored by lowshelf/highshelf. */
  Q: number;
  /** Gain in dB. Ignored by lowpass/highpass/bandpass/notch/allpass. */
  gain: number;
}

export type EQProfile = EQBand[];

/** Latency telemetry exposed by `EqualizerEngine.getLatencyMs()`. */
export interface DspLatencyReport {
  /** Hardware base latency reported by the AudioContext (s → ms). */
  baseMs: number;
  /** Output latency (s → ms). */
  outputMs: number;
  /** AudioWorklet/processing path latency (ms), if measured. */
  processingMs: number;
  /** Sum of the above, end-to-end estimate. */
  totalMs: number;
}

// ── Acoustic feature vector (richer than AcousticProfile) ───────────────────

/** Rough top-1 sound class label produced by the classifier. */
export type SoundClass =
  | 'speech'
  | 'music'
  | 'hvac'
  | 'traffic'
  | 'silence'
  | 'noise'
  | 'unknown';

/** Probability vector over `SoundClass` values, summing to ~1. */
export interface SoundClassDistribution {
  speech: number;
  music: number;
  hvac: number;
  traffic: number;
  silence: number;
  noise: number;
  unknown: number;
}

/**
 * One frame of acoustic features at ~10Hz.
 *
 * Structurally extends `AcousticProfile` so legacy consumers reading
 * `window.__residueAcoustic` keep working.
 */
export interface AcousticFeatureFrame extends AcousticProfile {
  /** RFC 3339 ms epoch. */
  timestamp: number;
  /** Spectral roll-off frequency (Hz) — 85% energy threshold. */
  spectralRolloff: number;
  /** Spectral flux (sum of |Δmag|) between this frame and the previous. */
  spectralFlux: number;
  /** Zero-crossing rate over the analysis window, normalised 0–1. */
  zeroCrossingRate: number;
  /** Top-1 sound class. */
  soundClass: SoundClass;
  /** Full posterior over sound classes. */
  soundClassDistribution: SoundClassDistribution;
  /** 7-band magnitudes (0–1), parallel to `frequencyBands` for fast ML use. */
  bandEnergies: number[];
}

/** Aggregate over a rolling window (default 60s). */
export interface RollingFeatureStats {
  windowSeconds: number;
  sampleCount: number;
  /** Mean per scalar feature. */
  mean: ScalarFeatureSet;
  /** Standard deviation per scalar feature. */
  std: ScalarFeatureSet;
  /** 10th percentile per scalar feature. */
  p10: ScalarFeatureSet;
  /** 90th percentile per scalar feature. */
  p90: ScalarFeatureSet;
}

/** Scalar features tracked in rolling stats. */
export interface ScalarFeatureSet {
  overallDb: number;
  spectralCentroid: number;
  spectralRolloff: number;
  spectralFlux: number;
  zeroCrossingRate: number;
  dominantFrequency: number;
}

// ── ML inference contract ───────────────────────────────────────────────────

/** Cognitive state classes emitted by the on-device classifier. */
export type StateLabel = 'focused' | 'scattered' | 'anxious' | 'drowsy';

export interface StateInferenceResult {
  /** Argmax label. */
  label: StateLabel;
  /** Softmax distribution in canonical label order. */
  probabilities: Record<StateLabel, number>;
  /** Continuous "match-to-goal" score in [0, 1]. */
  matchToGoal: number;
  /** Inference wall-clock latency in ms. */
  inferenceMs: number;
  /** Execution provider used by ORT (`webgpu` | `wasm` | `cpu`). */
  executionProvider: string;
  /** Model version / hash for traceability. */
  modelVersion: string;
  timestamp: number;
}

/** 13-dim acoustic feature vector consumed by the classifier. */
export interface AcousticFeatureVector13 {
  overallDb: number;
  bandEnergies: number[]; // length 7
  spectralCentroid: number;
  spectralRolloff: number;
  zeroCrossingRate: number;
  dominantFrequency: number;
  soundClassTop1OneHot: number[]; // length matches SoundClass cardinality
}

// ── Calibration ─────────────────────────────────────────────────────────────

/** One leg of the 60-second calibration sweep. */
export type CalibrationCondition =
  | 'white-noise-burst'
  | 'low-frequency-hum'
  | 'cafe'
  | 'silence';

export interface CalibrationLegResult {
  condition: CalibrationCondition;
  durationMs: number;
  typingSpeedWpm: number;
  errorRate: number; // 0–1
  productivityScore: number; // typingSpeed × (1 - errorRate), normalised
  averageDb: number;
}

export interface CalibrationResult {
  startedAt: number;
  finishedAt: number;
  legs: CalibrationLegResult[];
  /** Condition that produced the highest productivity. */
  optimalCondition: CalibrationCondition;
  /** EQ profile inferred to push the current room toward `optimalCondition`. */
  recommendedEQ: EQProfile;
}

// ── Bed (ElevenLabs handoff) ────────────────────────────────────────────────

export interface AmbientBed {
  /** Identifier from MongoDB / ElevenLabs cache. */
  id: string;
  /** MP3 (or other) URL. */
  url: string;
  /** Optional human-readable label for debug UI. */
  label?: string;
  /** Loop-friendly tail length in seconds. */
  durationSeconds?: number;
}

// ── Window globals (declaration-merged with lib/types/agents.ts) ────────────

declare global {
  interface Window {
    /**
     * 10 Hz acoustic feature frame. Structurally compatible with the legacy
     * `AcousticProfile` shape declared in `lib/types/agents.ts`, but populated
     * by Agent A's `FeatureExtractor` with the richer frame.
     */
    __residueAcousticFeatures?: AcousticFeatureFrame;
    /** Most recent rolling-window stats (60s). */
    __residueAcousticStats?: RollingFeatureStats;
    /** Most recent on-device state inference result. */
    __residueStateInference?: StateInferenceResult;
  }
}

export {};
