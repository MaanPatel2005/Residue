'use client';

/**
 * /demo — the "felt difference" demo route.
 *
 * Three big buttons (Raw / Optimal / A/B Toggle), a split-screen pre-EQ vs
 * post-EQ spectrum, a 60-second calibration flow, the live ML state readout,
 * and a DSP-latency badge. All running on a single shared AudioContext via
 * `lib/audio/AudioEngine`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import DemoControls from '@/components/DemoMode/DemoControls';
import CalibrationFlow from '@/components/DemoMode/CalibrationFlow';
import InferencePanel from '@/components/DemoMode/InferencePanel';
import SpectrumCompare from '@/components/SpectrumCompare/SpectrumCompare';

import {
  attachMicrophone,
  ensureRunning,
  teardownAudioEngine,
} from '@/lib/audio/AudioEngine';
import { FeatureExtractor } from '@/lib/audio/FeatureExtractor';
import { BedPlayer } from '@/lib/audio/BedPlayer';
import {
  EqualizerEngine,
  flatProfile,
  focusProfile,
} from '@/lib/dsp/EqualizerEngine';
import { StateClassifier } from '@/lib/ml/StateClassifier';
import { getResidueStore } from '@/lib/audio/sharedStore';
import type {
  CalibrationResult,
  DspLatencyReport,
  EQProfile,
  StateInferenceResult,
} from '@/lib/types/acoustic';
import type { DemoMode } from '@/lib/types/state';

const AB_PERIOD_MS = 3000;

export default function DemoPage() {
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<DemoMode>('idle');
  const [abLeg, setAbLeg] = useState<'raw' | 'optimal' | null>(null);
  const [latency, setLatency] = useState<DspLatencyReport | null>(null);
  const [inference, setInference] = useState<StateInferenceResult | null>(null);
  const [optimalProfile, setOptimalProfile] = useState<EQProfile>(focusProfile());
  const [calibration, setCalibration] = useState<CalibrationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const eqRef = useRef<EqualizerEngine | null>(null);
  const extractorRef = useRef<FeatureExtractor | null>(null);
  const bedRef = useRef<BedPlayer | null>(null);
  const classifierRef = useRef<StateClassifier | null>(null);
  const abTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyMode = useCallback(
    (m: DemoMode) => {
      const eq = eqRef.current;
      if (!eq) return;
      const store = getResidueStore();

      // Clear any previous A/B timer.
      if (abTimerRef.current) {
        clearInterval(abTimerRef.current);
        abTimerRef.current = null;
      }
      setAbLeg(null);

      switch (m) {
        case 'raw': {
          eq.bypass();
          store.setState({ demoMode: 'raw', eqProfile: null, abActiveLeg: null });
          break;
        }
        case 'optimal': {
          eq.setEQProfile(optimalProfile);
          store.setState({
            demoMode: 'optimal',
            eqProfile: optimalProfile,
            abActiveLeg: null,
          });
          break;
        }
        case 'ab-toggle': {
          // Start with raw, flip every 3s.
          let leg: 'raw' | 'optimal' = 'raw';
          eq.bypass();
          setAbLeg('raw');
          store.setState({ demoMode: 'ab-toggle', abActiveLeg: 'raw', eqProfile: null });

          abTimerRef.current = setInterval(() => {
            leg = leg === 'raw' ? 'optimal' : 'raw';
            if (leg === 'raw') {
              eq.bypass();
              store.setState({ abActiveLeg: 'raw', eqProfile: null });
            } else {
              eq.setEQProfile(optimalProfile);
              store.setState({ abActiveLeg: 'optimal', eqProfile: optimalProfile });
            }
            setAbLeg(leg);
          }, AB_PERIOD_MS);
          break;
        }
        case 'idle':
        default: {
          eq.bypass();
          store.setState({ demoMode: 'idle', eqProfile: null });
          break;
        }
      }
      setMode(m);
    },
    [optimalProfile],
  );

  const start = useCallback(async () => {
    try {
      setError(null);
      await ensureRunning();
      await attachMicrophone();

      // Build subsystems on top of the shared AudioContext.
      const eq = new EqualizerEngine();
      eq.setEQProfile(flatProfile()); // start neutral; demo mode toggles below
      eqRef.current = eq;

      const extractor = new FeatureExtractor({
        onFrame: () => {
          /* state.ts global is already updated by the extractor */
        },
      });
      extractor.start();
      extractorRef.current = extractor;

      const bed = new BedPlayer();
      bed.start();
      bedRef.current = bed;

      const classifier = new StateClassifier({
        onResult: (r) => setInference(r),
      });
      try {
        await classifier.start();
      } catch (err) {
        console.warn('[demo] classifier failed to load', err);
      }
      classifierRef.current = classifier;

      // Latency telemetry — measured & published every 1s.
      const measureLatency = () => {
        const r = eq.getLatency();
        setLatency(r);
        getResidueStore().setState({ measuredLatencyMs: r.totalMs, isProcessing: true });
      };
      measureLatency();
      const latencyTimer = setInterval(measureLatency, 1000);

      setRunning(true);
      // Default to raw mic-through so audio starts working immediately.
      applyMode('raw');

      return () => clearInterval(latencyTimer);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'failed to start');
    }
  }, [applyMode]);

  const stop = useCallback(async () => {
    if (abTimerRef.current) {
      clearInterval(abTimerRef.current);
      abTimerRef.current = null;
    }
    extractorRef.current?.stop();
    bedRef.current?.stop();
    classifierRef.current?.stop();
    eqRef.current?.bypass();
    eqRef.current = null;
    extractorRef.current = null;
    bedRef.current = null;
    classifierRef.current = null;
    await teardownAudioEngine();
    setRunning(false);
    setMode('idle');
    setAbLeg(null);
    getResidueStore().setState({ isProcessing: false, demoMode: 'idle', abActiveLeg: null });
  }, []);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply newly-calibrated EQ.
  const onCalibrationComplete = useCallback(
    (r: CalibrationResult) => {
      setCalibration(r);
      setOptimalProfile(r.recommendedEQ);
      getResidueStore().setState({ lastCalibration: r });
      // If we were in optimal mode, swap immediately.
      if (mode === 'optimal' || mode === 'ab-toggle') {
        eqRef.current?.setEQProfile(r.recommendedEQ);
      }
    },
    [mode],
  );

  return (
    <main
      style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      <header>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Residue · live demo</h1>
        <p style={{ fontSize: 13, color: '#9aa0c8', marginTop: 4 }}>
          Real-time EQ shaping of your acoustic environment, with on-device cognitive
          state inference. Plug in earbuds to feel the difference.
        </p>
      </header>

      <section
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          padding: 12,
          border: '1px solid #22224a',
          borderRadius: 12,
          background: '#0e0e22',
        }}
      >
        {!running ? (
          <button
            type="button"
            onClick={() => void start()}
            style={btnPrimary}
          >
            Start engine (mic permission required)
          </button>
        ) : (
          <button type="button" onClick={() => void stop()} style={btnGhost}>
            Stop engine
          </button>
        )}
        <span style={{ fontSize: 12, color: '#9aa0c8' }}>
          {running
            ? 'engine running · listening to mic · routed through EQ → speakers'
            : 'engine idle'}
        </span>
        {error && <span style={{ fontSize: 12, color: '#ff8a8a' }}>· {error}</span>}
      </section>

      <DemoControls mode={mode} abLeg={abLeg} onSelect={applyMode} />

      <SpectrumCompare paneHeight={220} />

      <InferencePanel inference={inference} latency={latency} />

      <CalibrationFlow onComplete={onCalibrationComplete} />

      {calibration && (
        <section
          style={{
            padding: 12,
            background: '#11112a',
            border: '1px solid #22224a',
            borderRadius: 12,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            Optimal condition for this judge: <code>{calibration.optimalCondition}</code>
          </div>
          <div style={{ fontSize: 12, color: '#9aa0c8', marginTop: 4 }}>
            EQ updated. Switch to &lsquo;My Optimal Profile&rsquo; to feel the shaping.
          </div>
        </section>
      )}
    </main>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: '10px 14px',
  border: '1px solid #6ad6ff',
  background: 'linear-gradient(180deg, #182550, #0e1837)',
  color: '#ededed',
  borderRadius: 10,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
};

const btnGhost: React.CSSProperties = {
  padding: '10px 14px',
  border: '1px solid #22224a',
  background: '#0e0e22',
  color: '#ededed',
  borderRadius: 10,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
};
