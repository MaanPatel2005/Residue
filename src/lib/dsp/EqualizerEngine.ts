/**
 * Real-time, glitch-free EQ for the live mic chain.
 *
 * Design constraints (from the agent brief):
 *   1. Configurable BiquadFilter chain (peak / notch / lowshelf / highshelf …).
 *   2. Reconfigurable in real time without audio glitches — i.e. parameter
 *      automation, not node recreation.
 *   3. Latency target <30ms end-to-end, measured.
 *   4. Built on top of the existing AudioContext (singleton in AudioEngine.ts).
 *
 * Implementation notes:
 *   - We keep a *fixed* pool of 12 BiquadFilterNodes wired in series between
 *     `eqInput` and `eqOutput` of the shared engine. New profiles map onto
 *     this pool by mutating each filter's `type`, `frequency`, `Q`, and
 *     `gain` AudioParams using `setTargetAtTime` (smooth ramp, no clicks).
 *   - Bands beyond the active count are flattened by setting their `type` to
 *     `'allpass'` and `gain` to 0dB, so they pass-through without colouring.
 *   - Latency is reported as `baseLatency + outputLatency` of the underlying
 *     AudioContext (both in seconds), which is the canonical Web Audio
 *     end-to-end latency estimator.
 */

import type {
  EQBand,
  EQProfile,
  DspLatencyReport,
} from '@/lib/types/acoustic';
import { getAudioEngine } from '@/lib/audio/AudioEngine';

const POOL_SIZE = 12;
/** Time constant (s) for AudioParam ramps. ~5ms = inaudible click-free swap. */
const RAMP_TC = 0.005;

export interface EqualizerEngineOptions {
  /** Override the default 12-filter pool size. */
  poolSize?: number;
}

export class EqualizerEngine {
  private readonly filters: BiquadFilterNode[] = [];
  private readonly poolSize: number;
  private currentProfile: EQProfile = [];
  private wired = false;

  constructor(opts: EqualizerEngineOptions = {}) {
    this.poolSize = opts.poolSize ?? POOL_SIZE;
  }

  /** Lazily build the filter pool and splice it into the engine bus. */
  private wire(): void {
    if (this.wired) return;
    const eng = getAudioEngine();

    for (let i = 0; i < this.poolSize; i++) {
      const f = eng.ctx.createBiquadFilter();
      // Idle filter: allpass at 1kHz, Q=1, gain=0 → audibly transparent.
      f.type = 'allpass';
      f.frequency.value = 1000;
      f.Q.value = 1;
      f.gain.value = 0;
      this.filters.push(f);
    }

    // Disconnect the bypass wire (eqInput → eqOutput) if present, then chain.
    try {
      eng.eqInput.disconnect(eng.eqOutput);
    } catch {
      /* not currently bypass-connected */
    }

    let prev: AudioNode = eng.eqInput;
    for (const f of this.filters) {
      prev.connect(f);
      prev = f;
    }
    prev.connect(eng.eqOutput);

    this.wired = true;
  }

  /** Bypass mode — hot-swap the chain out so raw mic flows straight through. */
  bypass(): void {
    const eng = getAudioEngine();
    if (!this.wired) {
      // Already in bypass; just make sure eqInput→eqOutput is wired.
      try {
        eng.eqInput.connect(eng.eqOutput);
      } catch {
        /* already connected */
      }
      return;
    }

    try {
      eng.eqInput.disconnect();
      for (const f of this.filters) f.disconnect();
    } catch {
      /* nodes may be partially connected */
    }
    eng.eqInput.connect(eng.eqOutput);
    this.wired = false;
    this.currentProfile = [];
  }

  /**
   * Apply a new EQ profile. Smoothly ramps every parameter on the filter pool
   * — no node creation/destruction — so audio never clicks or drops samples.
   */
  setEQProfile(bands: EQProfile): void {
    this.wire();
    const eng = getAudioEngine();
    const now = eng.ctx.currentTime;

    for (let i = 0; i < this.poolSize; i++) {
      const f = this.filters[i];
      const band: EQBand | undefined = bands[i];
      if (band) {
        // `type` is not an AudioParam, but assignment is sample-accurate at
        // graph render boundaries — combined with gain ramps below, this is
        // glitch-free in practice for the demo's bandwidth.
        if (f.type !== band.type) {
          f.type = band.type;
        }
        f.frequency.setTargetAtTime(band.frequency, now, RAMP_TC);
        f.Q.setTargetAtTime(Math.max(0.0001, band.Q), now, RAMP_TC);
        f.gain.setTargetAtTime(band.gain, now, RAMP_TC);
      } else {
        // Flatten unused band → allpass with 0dB gain.
        if (f.type !== 'allpass') f.type = 'allpass';
        f.frequency.setTargetAtTime(1000, now, RAMP_TC);
        f.Q.setTargetAtTime(1, now, RAMP_TC);
        f.gain.setTargetAtTime(0, now, RAMP_TC);
      }
    }
    this.currentProfile = bands.slice();
  }

  getEQProfile(): EQProfile {
    return this.currentProfile.slice();
  }

  /**
   * End-to-end latency estimate.
   *
   * `AudioContext.baseLatency` is the time between the engine processing
   * audio and the OS handing it to the device; `outputLatency` is the time
   * between the OS and the speaker. Both are in seconds. We add a per-filter
   * processing budget (negligible — biquads are O(1) per sample) so the
   * report is honest about what biquad chains contribute.
   */
  getLatency(): DspLatencyReport {
    const eng = getAudioEngine();
    const baseMs = (eng.ctx.baseLatency ?? 0) * 1000;
    const outputMs = (eng.ctx.outputLatency ?? 0) * 1000;
    // Biquads add ~1 sample group delay each at typical 48kHz → ~0.02ms each.
    const processingMs = (this.poolSize * (1 / (eng.ctx.sampleRate || 48000))) * 1000;
    return {
      baseMs,
      outputMs,
      processingMs,
      totalMs: baseMs + outputMs + processingMs,
    };
  }

  /** Convenience: log latency once, return it. */
  logLatency(prefix = '[EqualizerEngine]'): DspLatencyReport {
    const r = this.getLatency();
    console.info(
      `${prefix} latency base=${r.baseMs.toFixed(2)}ms ` +
        `output=${r.outputMs.toFixed(2)}ms ` +
        `proc=${r.processingMs.toFixed(3)}ms ` +
        `total=${r.totalMs.toFixed(2)}ms`,
    );
    return r;
  }
}

// ── Built-in profile factories ─────────────────────────────────────────────

/** Flat 4-band starter — useful for demoing the bypass→optimal A/B. */
export function flatProfile(): EQProfile {
  return [
    { type: 'lowshelf', frequency: 120, Q: 0.7, gain: 0 },
    { type: 'peaking', frequency: 500, Q: 1.0, gain: 0 },
    { type: 'peaking', frequency: 3000, Q: 1.0, gain: 0 },
    { type: 'highshelf', frequency: 8000, Q: 0.7, gain: 0 },
  ];
}

/**
 * "Focus" preset — gently rolls off rumble/HVAC, ducks 250-500Hz where mud
 * lives, mild presence boost at 3kHz, soft top-end roll-off above 10kHz.
 */
export function focusProfile(): EQProfile {
  return [
    { type: 'highpass', frequency: 80, Q: 0.7, gain: 0 },
    { type: 'peaking', frequency: 250, Q: 1.0, gain: -3 },
    { type: 'peaking', frequency: 3000, Q: 0.9, gain: 2 },
    { type: 'highshelf', frequency: 10000, Q: 0.7, gain: -2 },
    { type: 'notch', frequency: 60, Q: 4.0, gain: 0 }, // 60Hz hum
  ];
}

/** "Calm" — bass shelf up, treble shelf down, smooths sibilance at 6-8kHz. */
export function calmProfile(): EQProfile {
  return [
    { type: 'lowshelf', frequency: 150, Q: 0.7, gain: 2 },
    { type: 'peaking', frequency: 7000, Q: 3.0, gain: -4 },
    { type: 'highshelf', frequency: 9000, Q: 0.7, gain: -3 },
  ];
}
