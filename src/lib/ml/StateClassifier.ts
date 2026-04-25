/**
 * On-device cognitive-state classifier.
 *
 * Loads `public/models/state-classifier.onnx` via `onnxruntime-web` and runs
 * inference at ≥10Hz off the live `window.__residueAcousticFeatures` (Agent A)
 * and `window.__residueBehavior` (Agent B) feature streams.
 *
 * Provider strategy:
 *   1. Try `webgpu` first. ONNX Runtime Web's WebGPU EP is the closest
 *      stand-in for an on-NPU execution path inside a browser context, which
 *      keeps the ZETIC story honest: all inference runs on-device, with the
 *      model graph never leaving the user's machine.
 *      // TODO(zetic): when the ZETIC SDK runtime conversion lands, swap this
 *      // session creation for the ZETIC Melange runtime so the same `.onnx`
 *      // graph executes on the NPU directly. Output schema is identical.
 *   2. Fall back to `wasm` (SIMD + multi-thread when crossOriginIsolated).
 *
 * Output schema (5 floats per row): logits[0..3] over CLASS_NAMES + raw
 * match-to-goal score. We softmax the logits and sigmoid the score in JS so
 * the ONNX graph stays minimal.
 */

import * as ort from 'onnxruntime-web';

import type {
  AcousticFeatureFrame,
  AcousticFeatureVector13,
  StateInferenceResult,
  StateLabel,
  SoundClass,
} from '@/lib/types/acoustic';
import type { BehavioralFeatureVector } from '@/lib/types/agents';

const MODEL_URL = '/models/state-classifier.onnx';
const MODEL_VERSION = 'state-classifier-v1';
const INPUT_DIM = 19;
const NUM_CLASSES = 4;

const CLASS_ORDER: readonly StateLabel[] = [
  'focused',
  'scattered',
  'anxious',
  'drowsy',
] as const;

const SOUND_CLASS_ORDER: readonly SoundClass[] = [
  'speech',
  'music',
  'hvac',
  'traffic',
  'silence',
  'noise',
  'unknown',
] as const;

export interface StateClassifierOptions {
  /** Inference rate in Hz. Default 10. */
  rateHz?: number;
  /** Goal mode used in the goal-conditioned match score. */
  goal?: StateLabel;
  /** Optional callback after each inference tick. */
  onResult?: (r: StateInferenceResult) => void;
}

export class StateClassifier {
  private session: ort.InferenceSession | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private executionProvider = 'wasm';
  private readonly rateHz: number;
  private readonly onResult?: (r: StateInferenceResult) => void;
  private goal: StateLabel;

  constructor(opts: StateClassifierOptions = {}) {
    this.rateHz = opts.rateHz ?? 10;
    this.goal = opts.goal ?? 'focused';
    this.onResult = opts.onResult;
  }

  setGoal(goal: StateLabel): void {
    this.goal = goal;
  }

  async load(): Promise<void> {
    if (this.session) return;
    try {
      this.session = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ['webgpu', 'wasm'],
        graphOptimizationLevel: 'all',
      });
      const ep = (this.session as unknown as { executionProvider?: string })
        .executionProvider;
      this.executionProvider = ep ?? 'webgpu-or-wasm';
    } catch (err) {
      console.warn(
        '[StateClassifier] WebGPU unavailable, falling back to wasm',
        err,
      );
      this.session = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      this.executionProvider = 'wasm';
    }
  }

  async start(): Promise<void> {
    await this.load();
    if (this.timer) return;
    const intervalMs = 1000 / this.rateHz;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (!this.session) return;
    if (typeof window === 'undefined') return;
    const acoustic = window.__residueAcousticFeatures;
    if (!acoustic) return;

    // Behavioural features may be undefined if Agent B hasn't booted yet —
    // contract: substitute zeros rather than skip the inference.
    const behavioural = window.__residueBehavior ?? null;

    const input = buildInputVector(acoustic, behavioural);
    const tensor = new ort.Tensor('float32', input, [1, INPUT_DIM]);

    const start = performance.now();
    const output = await this.session.run({ input: tensor });
    const inferenceMs = performance.now() - start;

    const raw = output.output.data as Float32Array;
    const logits = Array.from(raw.slice(0, NUM_CLASSES));
    const scoreLogit = raw[NUM_CLASSES];

    const probs = softmax(logits);
    const probabilities: Record<StateLabel, number> = {
      focused: probs[0],
      scattered: probs[1],
      anxious: probs[2],
      drowsy: probs[3],
    };
    const argmaxIdx = probs.indexOf(Math.max(...probs));
    const label = CLASS_ORDER[argmaxIdx];
    const matchToGoal = sigmoid(scoreLogit) * probabilities[this.goal];

    const result: StateInferenceResult = {
      label,
      probabilities,
      matchToGoal,
      inferenceMs,
      executionProvider: this.executionProvider,
      modelVersion: MODEL_VERSION,
      timestamp: Date.now(),
    };

    if (typeof window !== 'undefined') {
      window.__residueStateInference = result;
    }
    this.onResult?.(result);
  }
}

// ── feature assembly ───────────────────────────────────────────────────────

/**
 * Build the 13-dim acoustic vector documented on `AcousticFeatureVector13`.
 * Exposed for unit-test parity with `scripts/train.py`.
 */
export function buildAcoustic13(frame: AcousticFeatureFrame): AcousticFeatureVector13 {
  return {
    overallDb: frame.overallDb,
    bandEnergies: frame.bandEnergies.slice(),
    spectralCentroid: frame.spectralCentroid,
    spectralRolloff: frame.spectralRolloff,
    zeroCrossingRate: frame.zeroCrossingRate,
    dominantFrequency: frame.dominantFrequency,
    soundClassTop1OneHot: oneHotSoundClass(frame.soundClass),
  };
}

function oneHotSoundClass(c: SoundClass): number[] {
  const out = new Array(SOUND_CLASS_ORDER.length).fill(0);
  const idx = SOUND_CLASS_ORDER.indexOf(c);
  if (idx >= 0) out[idx] = 1;
  return out;
}

function buildInputVector(
  acoustic: AcousticFeatureFrame,
  behavioural: BehavioralFeatureVector | null,
): Float32Array {
  const v = new Float32Array(INPUT_DIM);

  // Match the ordering & normalisation in scripts/train.py.
  v[0] = clamp(acoustic.overallDb / 100, 0, 1);

  for (let i = 0; i < 7; i++) {
    v[1 + i] = clamp(acoustic.bandEnergies[i] ?? 0, 0, 1);
  }

  v[8] = clamp(acoustic.spectralCentroid / 20000, 0, 1);
  v[9] = clamp(acoustic.spectralRolloff / 20000, 0, 1);
  v[10] = clamp(acoustic.zeroCrossingRate, 0, 1);
  v[11] = clamp(acoustic.dominantFrequency / 20000, 0, 1);

  // Compress the 7-class one-hot into a single ordinal channel matching
  // train.py's `soundClassTop1OneHot` slot (we feed the ordinal id / 6).
  const idx = SOUND_CLASS_ORDER.indexOf(acoustic.soundClass);
  v[12] = idx >= 0 ? idx / (SOUND_CLASS_ORDER.length - 1) : 0;

  // Behavioural — zeros if absent.
  if (behavioural) {
    v[13] = clamp(behavioural.typingSpeed / 100, 0, 1);
    v[14] = clamp(behavioural.errorRate, 0, 1);
    v[15] = clamp(behavioural.focusSwitchRate / 30, 0, 1);
    v[16] = clamp(behavioural.mouseJitter / 50, 0, 1);
    v[17] = clamp(behavioural.scrollVelocity / 1000, 0, 1);
    // No idleRatio in BehavioralFeatureVector yet — derive from interKeyLatency:
    // long latency → high idleRatio. Saturating mapping at 5000ms.
    v[18] = clamp(behavioural.interKeyLatency / 5000, 0, 1);
  }
  // else: already zeros

  return v;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function softmax(xs: number[]): number[] {
  const max = Math.max(...xs);
  const exps = xs.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
