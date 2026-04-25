/**
 * Shared application-state contract between Agent A and Agent B.
 *
 * Agent A owns this file. Only `export interface` / `export type` /
 * `export const` declarations belong here — runtime store implementation
 * lives in `lib/audio/sharedStore.ts`.
 *
 * The runtime store is exposed at `window.__residueState` and provides:
 *   - `getState()`
 *   - `setState(patch)`
 *   - `subscribe(listener) => unsubscribe`
 *
 * Both agents read/write through that contract so neither has to import
 * the other's modules directly.
 */

import type { EQProfile, AmbientBed, CalibrationResult } from '@/lib/types/acoustic';

/** Top-level demo / playback mode the user (or A/B harness) has selected. */
export type DemoMode = 'raw' | 'optimal' | 'ab-toggle' | 'idle';

/** Goal context — informs ML "match-to-goal" scoring and EQ choice. */
export type GoalMode = 'focus' | 'calm' | 'creative' | 'social';

/** Shared, read/write residue state. Both agents may mutate. */
export interface ResidueState {
  /** Current demo / playback mode. */
  demoMode: DemoMode;
  /** Currently active high-level goal (drives EQ + bed selection). */
  goalMode: GoalMode;
  /** Active EQ profile applied to the live mic chain. */
  eqProfile: EQProfile | null;
  /** URL of the active ambient bed (set by Agent B). null → fall back to synth. */
  activeBedUrl: string | null;
  /** Optional bed metadata Agent B may publish alongside the URL. */
  activeBed: AmbientBed | null;
  /** Latest end-to-end DSP latency in ms (Agent A writes). */
  measuredLatencyMs: number | null;
  /** Whether the mic→EQ→output chain is currently engaged. */
  isProcessing: boolean;
  /** Last completed calibration result, if any. */
  lastCalibration: CalibrationResult | null;
  /** A/B toggle indicator: which leg is currently audible. */
  abActiveLeg: 'raw' | 'optimal' | null;
}

export type ResidueStateListener = (state: ResidueState) => void;

/** Runtime contract for the shared store, exposed at `window.__residueState`. */
export interface ResidueStateStore {
  getState(): ResidueState;
  setState(patch: Partial<ResidueState>): void;
  subscribe(listener: ResidueStateListener): () => void;
}

/** Default initial value. Both agents may rely on this shape on first read. */
export const DEFAULT_RESIDUE_STATE: ResidueState = {
  demoMode: 'idle',
  goalMode: 'focus',
  eqProfile: null,
  activeBedUrl: null,
  activeBed: null,
  measuredLatencyMs: null,
  isProcessing: false,
  lastCalibration: null,
  abActiveLeg: null,
};

declare global {
  interface Window {
    /** Shared cross-agent runtime store (see `lib/audio/sharedStore.ts`). */
    __residueState?: ResidueStateStore;
  }
}

export {};
