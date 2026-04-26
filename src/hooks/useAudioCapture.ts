'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { AcousticProfile, FrequencyBand } from '@/types';

const FREQUENCY_BANDS: { label: string; range: [number, number] }[] = [
  { label: 'Sub-bass', range: [20, 60] },
  { label: 'Bass', range: [60, 250] },
  { label: 'Low-mid', range: [250, 500] },
  { label: 'Mid', range: [500, 2000] },
  { label: 'Upper-mid', range: [2000, 4000] },
  { label: 'Presence', range: [4000, 6000] },
  { label: 'Brilliance', range: [6000, 20000] },
];

const MIC_SIGNAL_THRESHOLD = 0.002;
const MIC_VALIDATION_TIMEOUT_MS = 3000;
const MIC_VALIDATION_INTERVAL_MS = 120;

type CaptureStartResult =
  | { ok: true }
  | { ok: false; message: string };

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateDb(analyser: AnalyserNode, dataArray: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(dataArray);
  let sumSquares = 0;
  for (let i = 0; i < dataArray.length; i++) {
    sumSquares += dataArray[i] * dataArray[i];
  }
  const rms = Math.sqrt(sumSquares / dataArray.length);
  const db = 20 * Math.log10(Math.max(rms, 1e-10));
  return Math.max(0, Math.min(120, db + 90));
}

function getFrequencyBands(
  analyser: AnalyserNode,
  freqData: Uint8Array<ArrayBuffer>,
  sampleRate: number
): FrequencyBand[] {
  analyser.getByteFrequencyData(freqData);
  const binSize = sampleRate / analyser.fftSize;

  return FREQUENCY_BANDS.map(({ label, range }) => {
    const startBin = Math.floor(range[0] / binSize);
    const endBin = Math.min(Math.floor(range[1] / binSize), freqData.length - 1);
    let sum = 0;
    let count = 0;
    for (let i = startBin; i <= endBin; i++) {
      sum += freqData[i];
      count++;
    }
    return {
      label,
      range,
      magnitude: count > 0 ? sum / count / 255 : 0,
    };
  });
}

function getDominantFrequency(
  analyser: AnalyserNode,
  freqData: Uint8Array<ArrayBuffer>,
  sampleRate: number
): number {
  analyser.getByteFrequencyData(freqData);
  const binSize = sampleRate / analyser.fftSize;
  let maxVal = 0;
  let maxIndex = 0;
  for (let i = 0; i < freqData.length; i++) {
    if (freqData[i] > maxVal) {
      maxVal = freqData[i];
      maxIndex = i;
    }
  }
  return maxIndex * binSize;
}

function getSpectralCentroid(
  analyser: AnalyserNode,
  freqData: Uint8Array<ArrayBuffer>,
  sampleRate: number
): number {
  analyser.getByteFrequencyData(freqData);
  const binSize = sampleRate / analyser.fftSize;
  let weightedSum = 0;
  let totalMagnitude = 0;
  for (let i = 0; i < freqData.length; i++) {
    weightedSum += freqData[i] * (i * binSize);
    totalMagnitude += freqData[i];
  }
  return totalMagnitude > 0 ? weightedSum / totalMagnitude : 0;
}

export function useAudioCapture() {
  const [isListening, setIsListening] = useState(false);
  const [currentProfile, setCurrentProfile] = useState<AcousticProfile | null>(null);
  const [rawFrequencyData, setRawFrequencyData] = useState<number[]>([]);
  /**
   * Surfaced when `getUserMedia` is unavailable or denied so the UI
   * can render a banner instead of silently doing nothing. Callers
   * can also handle this themselves by checking `error` after
   * `startListening()` returns.
   */
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);

  const cleanupAudioResources = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
    }
    audioContextRef.current = null;
    analyserRef.current = null;
    streamRef.current = null;
    animFrameRef.current = 0;
  }, []);

  const validateMicSignal = useCallback(async (analyser: AnalyserNode) => {
    const samples = new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>;
    const startedAt = Date.now();

    while (Date.now() - startedAt < MIC_VALIDATION_TIMEOUT_MS) {
      analyser.getFloatTimeDomainData(samples);
      let sumSquares = 0;
      for (let i = 0; i < samples.length; i++) {
        sumSquares += samples[i] * samples[i];
      }
      const rms = Math.sqrt(sumSquares / samples.length);
      if (rms >= MIC_SIGNAL_THRESHOLD) {
        return true;
      }
      await wait(MIC_VALIDATION_INTERVAL_MS);
    }

    return false;
  }, []);

  const analyze = useCallback(() => {
    const analyser = analyserRef.current;
    const ctx = audioContextRef.current;
    if (!analyser || !ctx) return;

    const freqData = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
    const timeData = new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>;
    const sampleRate = ctx.sampleRate;

    const update = () => {
      const overallDb = calculateDb(analyser, timeData);
      const frequencyBands = getFrequencyBands(analyser, freqData, sampleRate);
      const dominantFrequency = getDominantFrequency(analyser, freqData, sampleRate);
      const spectralCentroid = getSpectralCentroid(analyser, freqData, sampleRate);

      analyser.getByteFrequencyData(freqData);
      setRawFrequencyData(Array.from(freqData.slice(0, 128)));

      setCurrentProfile({
        timestamp: Date.now(),
        overallDb,
        frequencyBands,
        dominantFrequency,
        spectralCentroid,
      });

      animFrameRef.current = requestAnimationFrame(update);
    };

    update();
  }, []);

  const startListening = useCallback(async (): Promise<CaptureStartResult> => {
    setError(null);
    cleanupAudioResources();
    setIsListening(false);
    setCurrentProfile(null);

    // navigator.mediaDevices is only defined in a "secure context"
    // (https:// or http://localhost / 127.0.0.1). Loading the dev
    // server from a LAN IP like http://10.30.227.114:3000 — which is
    // what we do when testing the iOS companion against the laptop —
    // makes mediaDevices undefined, and calling .getUserMedia on it
    // throws "Cannot read properties of undefined". Catch that case
    // explicitly and surface a useful message instead of a generic
    // crash.
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      const isSecure = typeof window !== 'undefined' && window.isSecureContext;
      const host = typeof window !== 'undefined' ? window.location.hostname : '';
      const message = isSecure
        ? 'Microphone access is unavailable in this browser.'
        : `Microphone access requires a secure context. Open Residue at http://localhost:3000 (or behind HTTPS) instead of http://${host}:3000 — Chrome blocks getUserMedia on insecure LAN origins.`;
      console.error('[useAudioCapture]', message);
      setError(message);
      return { ok: false, message };
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      const ctx = new AudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);

      audioContextRef.current = ctx;
      analyserRef.current = analyser;
      streamRef.current = stream;

      const hasSignal = await validateMicSignal(analyser);
      if (!hasSignal) {
        const message = 'No microphone signal detected. Choose the active mic, then speak or make a sound before continuing.';
        console.error('[useAudioCapture]', message);
        setError(message);
        cleanupAudioResources();
        return { ok: false, message };
      }

      setIsListening(true);
      analyze();
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Microphone access denied';
      console.error('Microphone access denied:', err);
      setError(message);
      cleanupAudioResources();
      return { ok: false, message };
    }
  }, [analyze, cleanupAudioResources, validateMicSignal]);

  const stopListening = useCallback(() => {
    cleanupAudioResources();
    setIsListening(false);
    setCurrentProfile(null);
  }, [cleanupAudioResources]);

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  return {
    isListening,
    currentProfile,
    rawFrequencyData,
    startListening,
    stopListening,
    error,
  };
}
