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

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);

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

  const startListening = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);

      audioContextRef.current = ctx;
      analyserRef.current = analyser;
      streamRef.current = stream;

      setIsListening(true);
      analyze();
    } catch (err) {
      console.error('Microphone access denied:', err);
    }
  }, [analyze]);

  const stopListening = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    audioContextRef.current = null;
    analyserRef.current = null;
    streamRef.current = null;
    setIsListening(false);
    setCurrentProfile(null);
  }, []);

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
  };
}
