/**
 * 10Hz acoustic feature extractor.
 *
 * Pulls FFT/time-domain data off the *input* analyser of the shared
 * AudioEngine, computes a richer feature set than the MVP's
 * `useAudioCapture` hook (spectral roll-off, spectral flux, ZCR, sound-class
 * heuristic), maintains a 60-second rolling window with mean / std / p10 /
 * p90 stats, and broadcasts each frame on `window.__residueAcoustic` (legacy
 * shape) and `window.__residueAcousticFeatures` (rich shape) for Agent B.
 *
 * NOTE on sound classification: the brief calls out YAMNet as a stretch goal.
 * We ship a fast, dependency-free heuristic classifier here that uses
 * spectral shape to pick {speech | music | hvac | traffic | silence | noise}.
 * `StateClassifier` consumes the top-1 one-hot, so swapping in YAMNet later
 * is a drop-in change.
 */

import type { FrequencyBand } from '@/types';
import type {
  AcousticFeatureFrame,
  RollingFeatureStats,
  ScalarFeatureSet,
  SoundClass,
  SoundClassDistribution,
} from '@/lib/types/acoustic';
import { getAudioEngine } from '@/lib/audio/AudioEngine';

const FREQUENCY_BANDS: { label: string; range: [number, number] }[] = [
  { label: 'Sub-bass', range: [20, 60] },
  { label: 'Bass', range: [60, 250] },
  { label: 'Low-mid', range: [250, 500] },
  { label: 'Mid', range: [500, 2000] },
  { label: 'Upper-mid', range: [2000, 4000] },
  { label: 'Presence', range: [4000, 6000] },
  { label: 'Brilliance', range: [6000, 20000] },
];

const TARGET_HZ = 10;
const ROLLING_WINDOW_S = 60;
const ROLLING_BUFFER_LEN = TARGET_HZ * ROLLING_WINDOW_S;

const SOUND_CLASS_KEYS: readonly SoundClass[] = [
  'speech',
  'music',
  'hvac',
  'traffic',
  'silence',
  'noise',
  'unknown',
] as const;

export interface FeatureExtractorOptions {
  /** Override 10Hz emit rate. */
  rateHz?: number;
  /** Optional callback invoked with each frame (for React state plumbing). */
  onFrame?: (frame: AcousticFeatureFrame) => void;
  /** Optional callback invoked with each rolling-stats update. */
  onStats?: (stats: RollingFeatureStats) => void;
}

type ScalarRingEntry = ScalarFeatureSet;

export class FeatureExtractor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private prevMag: Float32Array | null = null;
  private readonly ring: ScalarRingEntry[] = [];
  private readonly rateHz: number;
  private readonly onFrame?: (frame: AcousticFeatureFrame) => void;
  private readonly onStats?: (stats: RollingFeatureStats) => void;

  constructor(opts: FeatureExtractorOptions = {}) {
    this.rateHz = opts.rateHz ?? TARGET_HZ;
    this.onFrame = opts.onFrame;
    this.onStats = opts.onStats;
  }

  start(): void {
    if (this.timer) return;
    const intervalMs = 1000 / this.rateHz;
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.prevMag = null;
    this.ring.length = 0;
  }

  /** One feature-extraction frame. */
  private tick(): void {
    const eng = getAudioEngine();
    const analyser = eng.inputAnalyser;
    const sampleRate = eng.ctx.sampleRate;

    const fftBins = analyser.frequencyBinCount;
    const fftSize = analyser.fftSize;
    const freq = new Uint8Array(fftBins);
    const time = new Float32Array(fftSize);
    analyser.getByteFrequencyData(freq);
    analyser.getFloatTimeDomainData(time);

    // ── core scalars ─────────────────────────────────────────────────────
    const overallDb = computeDbFromTime(time);
    const binSize = sampleRate / fftSize;

    const bands = computeBands(freq, binSize);
    const bandEnergies = bands.map((b) => b.magnitude);

    const dominantFrequency = computeDominantFrequency(freq, binSize);
    const spectralCentroid = computeSpectralCentroid(freq, binSize);
    const spectralRolloff = computeSpectralRolloff(freq, binSize, 0.85);
    const spectralFlux = computeSpectralFlux(freq, this.prevMag);
    this.prevMag = Float32Array.from(freq, (v) => v / 255);

    const zcr = computeZeroCrossingRate(time);

    // ── sound classification (heuristic; swap to YAMNet later) ───────────
    const soundClassDistribution = classifySound({
      overallDb,
      spectralCentroid,
      spectralRolloff,
      zeroCrossingRate: zcr,
      bandEnergies,
    });
    const soundClass = topClass(soundClassDistribution);

    const frame: AcousticFeatureFrame = {
      timestamp: Date.now(),
      overallDb,
      frequencyBands: bands,
      dominantFrequency,
      spectralCentroid,
      spectralRolloff,
      spectralFlux,
      zeroCrossingRate: zcr,
      soundClass,
      soundClassDistribution,
      bandEnergies,
    };

    // ── rolling stats ────────────────────────────────────────────────────
    this.ring.push({
      overallDb,
      spectralCentroid,
      spectralRolloff,
      spectralFlux,
      zeroCrossingRate: zcr,
      dominantFrequency,
    });
    if (this.ring.length > ROLLING_BUFFER_LEN) this.ring.shift();
    const stats = computeRollingStats(this.ring);

    // ── publish ──────────────────────────────────────────────────────────
    if (typeof window !== 'undefined') {
      // Legacy slot — AcousticProfile-shaped consumers keep working.
      window.__residueAcoustic = frame;
      window.__residueAcousticFeatures = frame;
      window.__residueAcousticStats = stats;
    }
    this.onFrame?.(frame);
    this.onStats?.(stats);
  }
}

// ── DSP helpers ────────────────────────────────────────────────────────────

function computeDbFromTime(time: Float32Array): number {
  let sumSquares = 0;
  for (let i = 0; i < time.length; i++) sumSquares += time[i] * time[i];
  const rms = Math.sqrt(sumSquares / time.length);
  const db = 20 * Math.log10(Math.max(rms, 1e-10));
  return Math.max(0, Math.min(120, db + 90));
}

function computeBands(freq: Uint8Array, binSize: number): FrequencyBand[] {
  return FREQUENCY_BANDS.map(({ label, range }) => {
    const startBin = Math.floor(range[0] / binSize);
    const endBin = Math.min(Math.floor(range[1] / binSize), freq.length - 1);
    let sum = 0;
    let count = 0;
    for (let i = startBin; i <= endBin; i++) {
      sum += freq[i];
      count++;
    }
    return {
      label,
      range,
      magnitude: count > 0 ? sum / count / 255 : 0,
    };
  });
}

function computeDominantFrequency(freq: Uint8Array, binSize: number): number {
  let maxVal = 0;
  let maxIdx = 0;
  for (let i = 0; i < freq.length; i++) {
    if (freq[i] > maxVal) {
      maxVal = freq[i];
      maxIdx = i;
    }
  }
  return maxIdx * binSize;
}

function computeSpectralCentroid(freq: Uint8Array, binSize: number): number {
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < freq.length; i++) {
    weighted += freq[i] * (i * binSize);
    total += freq[i];
  }
  return total > 0 ? weighted / total : 0;
}

function computeSpectralRolloff(
  freq: Uint8Array,
  binSize: number,
  fraction: number,
): number {
  let total = 0;
  for (let i = 0; i < freq.length; i++) total += freq[i];
  if (total === 0) return 0;
  const target = total * fraction;
  let cumulative = 0;
  for (let i = 0; i < freq.length; i++) {
    cumulative += freq[i];
    if (cumulative >= target) return i * binSize;
  }
  return freq.length * binSize;
}

function computeSpectralFlux(freq: Uint8Array, prev: Float32Array | null): number {
  if (!prev) return 0;
  const len = Math.min(freq.length, prev.length);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const cur = freq[i] / 255;
    const diff = cur - prev[i];
    if (diff > 0) sum += diff;
  }
  return sum / len;
}

function computeZeroCrossingRate(time: Float32Array): number {
  let crossings = 0;
  for (let i = 1; i < time.length; i++) {
    if ((time[i - 1] >= 0 && time[i] < 0) || (time[i - 1] < 0 && time[i] >= 0)) {
      crossings++;
    }
  }
  return crossings / time.length;
}

// ── Sound classification heuristic ─────────────────────────────────────────

interface ClassifyInput {
  overallDb: number;
  spectralCentroid: number;
  spectralRolloff: number;
  zeroCrossingRate: number;
  bandEnergies: number[]; // 7 entries, parallel to FREQUENCY_BANDS
}

/**
 * Lightweight rule-based classifier. Outputs a normalised distribution over
 * `SoundClass`. Logic lifted from typical YAMNet feature thresholds.
 *
 * Intentionally conservative — when nothing matches strongly we lean toward
 * `unknown` so the downstream ML model can dominate.
 */
function classifySound(x: ClassifyInput): SoundClassDistribution {
  const dist: Record<SoundClass, number> = {
    speech: 0,
    music: 0,
    hvac: 0,
    traffic: 0,
    silence: 0,
    noise: 0,
    unknown: 0.1,
  };

  if (x.overallDb < 30) {
    dist.silence += 1.0;
  } else {
    // Energy buckets: bass-dominant + low ZCR → HVAC/traffic.
    const bass = x.bandEnergies[0] + x.bandEnergies[1];
    const mid = x.bandEnergies[2] + x.bandEnergies[3];
    const upper = x.bandEnergies[4] + x.bandEnergies[5] + x.bandEnergies[6];

    if (bass > mid && bass > upper && x.zeroCrossingRate < 0.05) {
      // Hum-like.
      if (x.overallDb > 55) dist.traffic += 0.7;
      else dist.hvac += 0.8;
    }
    if (mid > 0.25 && x.zeroCrossingRate > 0.08 && x.zeroCrossingRate < 0.25) {
      dist.speech += 0.9;
    }
    if (upper > 0.15 && x.spectralRolloff > 4000 && x.zeroCrossingRate > 0.04) {
      dist.music += 0.6;
    }
    if (x.zeroCrossingRate > 0.3) {
      dist.noise += 0.5;
    }
  }

  // Normalise.
  let total = 0;
  for (const k of SOUND_CLASS_KEYS) total += dist[k];
  if (total === 0) dist.unknown = 1;
  else for (const k of SOUND_CLASS_KEYS) dist[k] = dist[k] / total;

  return dist as SoundClassDistribution;
}

function topClass(dist: SoundClassDistribution): SoundClass {
  let best: SoundClass = 'unknown';
  let bestVal = -Infinity;
  for (const k of SOUND_CLASS_KEYS) {
    if (dist[k] > bestVal) {
      bestVal = dist[k];
      best = k;
    }
  }
  return best;
}

// ── Rolling stats ──────────────────────────────────────────────────────────

function computeRollingStats(ring: ScalarRingEntry[]): RollingFeatureStats {
  const n = ring.length;
  const empty: ScalarFeatureSet = {
    overallDb: 0,
    spectralCentroid: 0,
    spectralRolloff: 0,
    spectralFlux: 0,
    zeroCrossingRate: 0,
    dominantFrequency: 0,
  };

  if (n === 0) {
    return {
      windowSeconds: ROLLING_WINDOW_S,
      sampleCount: 0,
      mean: empty,
      std: empty,
      p10: empty,
      p90: empty,
    };
  }

  const keys: (keyof ScalarFeatureSet)[] = [
    'overallDb',
    'spectralCentroid',
    'spectralRolloff',
    'spectralFlux',
    'zeroCrossingRate',
    'dominantFrequency',
  ];

  const mean: ScalarFeatureSet = { ...empty };
  for (const r of ring) for (const k of keys) mean[k] += r[k];
  for (const k of keys) mean[k] /= n;

  const std: ScalarFeatureSet = { ...empty };
  for (const r of ring)
    for (const k of keys) std[k] += (r[k] - mean[k]) * (r[k] - mean[k]);
  for (const k of keys) std[k] = Math.sqrt(std[k] / n);

  const p10: ScalarFeatureSet = { ...empty };
  const p90: ScalarFeatureSet = { ...empty };
  for (const k of keys) {
    const sorted = ring.map((r) => r[k]).sort((a, b) => a - b);
    p10[k] = percentile(sorted, 0.1);
    p90[k] = percentile(sorted, 0.9);
  }

  return {
    windowSeconds: ROLLING_WINDOW_S,
    sampleCount: n,
    mean,
    std,
    p10,
    p90,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[idx];
}
