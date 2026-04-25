'use client';

/**
 * 60-second "calibrate for this judge" sequence.
 *
 * Plays four 12s background acoustic conditions through the speakers while
 * the user types a fixed paragraph. Per leg we collect:
 *   - typing speed (chars per second × 12 / 5 ≈ WPM proxy)
 *   - error rate (chars not matching prompt at the corresponding index)
 *   - average dB measured on the input analyser
 *
 * The leg with the highest `typingSpeed × (1 - errorRate)` wins. We then
 * synthesize an EQ profile that pushes the *current* room toward the winning
 * condition's spectral profile and publish it via `setEQProfile`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CalibrationCondition,
  CalibrationLegResult,
  CalibrationResult,
  EQProfile,
} from '@/lib/types/acoustic';
import { getAudioEngine, ensureRunning } from '@/lib/audio/AudioEngine';

const LEG_SECONDS = 12;
const CONDITIONS: CalibrationCondition[] = [
  'white-noise-burst',
  'low-frequency-hum',
  'cafe',
  'silence',
];

const PROMPT_TEXT =
  'The quiet hum of focused work is something we feel before we name it. ' +
  'When the room is right the words flow forward, even paragraphs like this one ' +
  'arrive without friction, almost as if the noise has been quietly negotiated.';

export interface CalibrationFlowProps {
  /** Called when the run finishes with a winning EQ profile. */
  onComplete: (result: CalibrationResult) => void;
}

export default function CalibrationFlow({ onComplete }: CalibrationFlowProps) {
  const [running, setRunning] = useState(false);
  const [legIdx, setLegIdx] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [typed, setTyped] = useState('');
  const [legs, setLegs] = useState<CalibrationLegResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stimulusRef = useRef<{ source: AudioBufferSourceNode; gain: GainNode } | null>(null);
  const dbSamplesRef = useRef<number[]>([]);
  const dbTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (stimulusRef.current) {
      try {
        stimulusRef.current.source.stop();
      } catch {
        /* already stopped */
      }
      stimulusRef.current.source.disconnect();
      stimulusRef.current.gain.disconnect();
      stimulusRef.current = null;
    }
    if (dbTimerRef.current) {
      clearInterval(dbTimerRef.current);
      dbTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const startStimulus = useCallback(async (cond: CalibrationCondition) => {
    cleanup();
    await ensureRunning();
    const eng = getAudioEngine();
    const buffer = synthCondition(eng.ctx, cond);

    const source = eng.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = eng.ctx.createGain();
    gain.gain.value = cond === 'silence' ? 0 : 0.35;
    source.connect(gain);
    gain.connect(eng.bedBus); // route via bed bus → master out
    eng.bedBus.gain.setTargetAtTime(1, eng.ctx.currentTime, 0.05);
    source.start();
    stimulusRef.current = { source, gain };

    dbSamplesRef.current = [];
    dbTimerRef.current = setInterval(() => {
      const sample = window.__residueAcousticFeatures?.overallDb ?? 0;
      dbSamplesRef.current.push(sample);
    }, 200);
  }, [cleanup]);

  const finishLeg = useCallback(() => {
    const cond = CONDITIONS[legIdx];
    const dbSamples = dbSamplesRef.current;
    const avgDb =
      dbSamples.length > 0 ? dbSamples.reduce((a, b) => a + b, 0) / dbSamples.length : 0;

    const typedNow = inputRef.current?.value ?? '';
    const charsTyped = typedNow.length;
    const compareLen = Math.min(charsTyped, PROMPT_TEXT.length);
    let errors = 0;
    for (let i = 0; i < compareLen; i++) {
      if (typedNow[i] !== PROMPT_TEXT[i]) errors++;
    }
    const errorRate = compareLen === 0 ? 1 : errors / compareLen;
    // WPM proxy: (chars / 5) per minute
    const typingSpeedWpm = (charsTyped / 5) / (LEG_SECONDS / 60);
    const productivityScore = typingSpeedWpm * (1 - errorRate);

    const leg: CalibrationLegResult = {
      condition: cond,
      durationMs: LEG_SECONDS * 1000,
      typingSpeedWpm,
      errorRate,
      productivityScore,
      averageDb: avgDb,
    };

    setLegs((prev) => {
      const next = [...prev, leg];
      const isLast = next.length === CONDITIONS.length;
      if (isLast) {
        cleanup();
        const optimal = next.reduce((best, x) =>
          x.productivityScore > best.productivityScore ? x : best,
        );
        const result: CalibrationResult = {
          startedAt: Date.now() - CONDITIONS.length * LEG_SECONDS * 1000,
          finishedAt: Date.now(),
          legs: next,
          optimalCondition: optimal.condition,
          recommendedEQ: deriveRecommendedEQ(optimal.condition),
        };
        setRunning(false);
        setSecondsLeft(0);
        onComplete(result);
      }
      return next;
    });

    // Reset typed buffer for the next leg.
    if (inputRef.current) inputRef.current.value = '';
    setTyped('');
  }, [legIdx, cleanup, onComplete]);

  // Per-leg timer. We avoid a synchronous setState inside the effect body
  // (react-hooks/set-state-in-effect) by deriving `secondsLeft` from
  // `Date.now() - legStartedAt` inside the interval callback only.
  const legStartedAtRef = useRef<number>(0);
  useEffect(() => {
    if (!running) return;
    if (legIdx >= CONDITIONS.length) return;

    legStartedAtRef.current = Date.now();
    void startStimulus(CONDITIONS[legIdx]);
    inputRef.current?.focus();

    const tick = setInterval(() => {
      const elapsed = (Date.now() - legStartedAtRef.current) / 1000;
      const remaining = Math.max(0, LEG_SECONDS - Math.floor(elapsed));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        clearInterval(tick);
        finishLeg();
        setLegIdx((i) => i + 1);
      }
    }, 200);

    return () => clearInterval(tick);
  }, [running, legIdx, startStimulus, finishLeg]);

  const start = useCallback(async () => {
    try {
      setError(null);
      setLegs([]);
      setLegIdx(0);
      setRunning(true);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'calibration failed');
      setRunning(false);
    }
  }, []);

  const cond = CONDITIONS[legIdx];
  const totalLegs = CONDITIONS.length;

  return (
    <div
      style={{
        background: '#11112a',
        border: '1px solid #22224a',
        borderRadius: 12,
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Calibrate for this judge in 60 seconds</span>
        <span style={{ fontSize: 11, color: '#8a8aa8' }}>
          {running
            ? `leg ${Math.min(legIdx + 1, totalLegs)} / ${totalLegs} · ${cond ?? '—'} · ${secondsLeft}s`
            : 'press start, then type the paragraph for each background'}
        </span>
      </div>

      {!running && legs.length === 0 && (
        <button
          type="button"
          onClick={start}
          style={{
            padding: '10px 14px',
            border: '1px solid #6ad6ff',
            background: '#0e1837',
            color: '#ededed',
            borderRadius: 10,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Start 60-second calibration
        </button>
      )}

      {running && (
        <>
          <div style={{ fontSize: 12, color: '#9aa0c8', marginBottom: 6 }}>
            Type this paragraph as accurately as you can:
          </div>
          <div
            style={{
              fontFamily: 'var(--font-geist-mono), monospace',
              background: '#0a0a1a',
              padding: 8,
              borderRadius: 8,
              fontSize: 12,
              color: '#9aa0c8',
              lineHeight: 1.5,
            }}
          >
            {PROMPT_TEXT}
          </div>
          <textarea
            ref={inputRef}
            onChange={(e) => setTyped(e.target.value)}
            value={typed}
            placeholder="start typing…"
            style={{
              marginTop: 8,
              width: '100%',
              minHeight: 80,
              padding: 8,
              background: '#0e0e22',
              color: '#ededed',
              border: '1px solid #22224a',
              borderRadius: 8,
              fontFamily: 'var(--font-geist-mono), monospace',
              fontSize: 12,
              outline: 'none',
            }}
          />
        </>
      )}

      {legs.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: '#9aa0c8', marginBottom: 4 }}>Results so far:</div>
          {legs.map((l) => (
            <div
              key={l.condition}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto',
                gap: 8,
                fontSize: 11,
                color: '#cdd1ee',
                padding: '4px 0',
                borderBottom: '1px solid #1a1a3a',
              }}
            >
              <span>{l.condition}</span>
              <span>{l.typingSpeedWpm.toFixed(0)} wpm</span>
              <span>{(l.errorRate * 100).toFixed(0)}% err</span>
              <span style={{ color: '#a4ffb4' }}>{l.productivityScore.toFixed(1)}</span>
            </div>
          ))}
        </div>
      )}

      {error && <div style={{ color: '#ff8a8a', fontSize: 12, marginTop: 8 }}>{error}</div>}
    </div>
  );
}

// ── stimulus synthesis & EQ derivation ─────────────────────────────────────

function synthCondition(ctx: AudioContext, cond: CalibrationCondition): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const duration = 4;
  const length = sampleRate * duration;
  const buffer = ctx.createBuffer(2, length, sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    switch (cond) {
      case 'white-noise-burst': {
        for (let i = 0; i < length; i++) {
          const env = i % (sampleRate / 2) < sampleRate / 4 ? 1 : 0.4;
          data[i] = (Math.random() * 2 - 1) * 0.6 * env;
        }
        break;
      }
      case 'low-frequency-hum': {
        // 60Hz hum + 120Hz harmonic
        for (let i = 0; i < length; i++) {
          const t = i / sampleRate;
          data[i] = (Math.sin(2 * Math.PI * 60 * t) + 0.4 * Math.sin(2 * Math.PI * 120 * t)) * 0.3;
        }
        break;
      }
      case 'cafe': {
        // brown-noise base + sine murmur
        let last = 0;
        for (let i = 0; i < length; i++) {
          const white = Math.random() * 2 - 1;
          last = (last + 0.02 * white) / 1.02;
          const murmur = Math.sin(i * 0.001 * (1 + Math.random() * 0.5)) * 0.05;
          data[i] = (last * 2 + murmur) * (0.8 + Math.random() * 0.4) * 0.3;
        }
        break;
      }
      case 'silence':
      default: {
        // leave zeroed
        break;
      }
    }
  }
  return buffer;
}

/** Map the winning condition to an EQ that nudges the room toward it. */
function deriveRecommendedEQ(cond: CalibrationCondition): EQProfile {
  switch (cond) {
    case 'silence':
      return [
        { type: 'highpass', frequency: 80, Q: 0.7, gain: 0 },
        { type: 'peaking', frequency: 250, Q: 1, gain: -4 },
        { type: 'peaking', frequency: 4000, Q: 1, gain: -2 },
        { type: 'highshelf', frequency: 9000, Q: 0.7, gain: -3 },
      ];
    case 'cafe':
      return [
        { type: 'lowshelf', frequency: 150, Q: 0.7, gain: 1 },
        { type: 'peaking', frequency: 800, Q: 0.8, gain: 2 },
        { type: 'peaking', frequency: 4000, Q: 1.2, gain: -2 },
      ];
    case 'low-frequency-hum':
      return [
        { type: 'notch', frequency: 60, Q: 6, gain: 0 },
        { type: 'notch', frequency: 120, Q: 6, gain: 0 },
        { type: 'peaking', frequency: 3000, Q: 0.9, gain: 2 },
      ];
    case 'white-noise-burst':
      return [
        { type: 'highshelf', frequency: 8000, Q: 0.7, gain: -4 },
        { type: 'peaking', frequency: 5000, Q: 1, gain: -3 },
        { type: 'lowshelf', frequency: 200, Q: 0.7, gain: 1 },
      ];
  }
}
