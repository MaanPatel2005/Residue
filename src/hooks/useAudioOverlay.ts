'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

type SoundType = 'brown-noise' | 'pink-noise' | 'white-noise' | 'rain' | 'cafe' | 'binaural' | 'ai-generated';

interface OverlayState {
  isPlaying: boolean;
  soundType: SoundType;
  volume: number;
  targetDb: number;
  aiGenerating: boolean;
  aiPrompt: string | null;
}

function createNoiseBuffer(
  ctx: AudioContext,
  type: SoundType
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const duration = 4;
  const length = sampleRate * duration;
  const buffer = ctx.createBuffer(2, length, sampleRate);

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);

    switch (type) {
      case 'brown-noise': {
        let last = 0;
        for (let i = 0; i < length; i++) {
          const white = Math.random() * 2 - 1;
          last = (last + 0.02 * white) / 1.02;
          data[i] = last * 3.5;
        }
        break;
      }
      case 'pink-noise': {
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < length; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.96900 * b2 + white * 0.1538520;
          b3 = 0.86650 * b3 + white * 0.3104856;
          b4 = 0.55000 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.0168980;
          data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
          b6 = white * 0.115926;
        }
        break;
      }
      case 'white-noise': {
        for (let i = 0; i < length; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        break;
      }
      case 'rain': {
        for (let i = 0; i < length; i++) {
          const white = Math.random() * 2 - 1;
          const envelope = Math.random() < 0.001 ? 0.8 : 0.1;
          data[i] = white * envelope;
        }
        let b = 0;
        for (let i = 0; i < length; i++) {
          b = 0.97 * b + data[i] * 0.03;
          data[i] = b * 5;
        }
        break;
      }
      case 'cafe': {
        let brownLast = 0;
        for (let i = 0; i < length; i++) {
          const white = Math.random() * 2 - 1;
          brownLast = (brownLast + 0.02 * white) / 1.02;
          const murmur = Math.sin(i * 0.001 * (1 + Math.random() * 0.5)) * 0.05;
          data[i] = (brownLast * 2 + murmur) * (0.8 + Math.random() * 0.4);
        }
        break;
      }
      case 'binaural': {
        const baseFreq = 200;
        const beatFreq = 10;
        const leftFreq = baseFreq;
        const rightFreq = baseFreq + beatFreq;
        const freq = channel === 0 ? leftFreq : rightFreq;
        for (let i = 0; i < length; i++) {
          data[i] = Math.sin(2 * Math.PI * freq * i / sampleRate) * 0.3;
        }
        break;
      }
      default: {
        for (let i = 0; i < length; i++) {
          data[i] = Math.random() * 2 - 1;
        }
      }
    }
  }

  return buffer;
}

export function useAudioOverlay() {
  const [overlayState, setOverlayState] = useState<OverlayState>({
    isPlaying: false,
    soundType: 'brown-noise',
    volume: 0.3,
    targetDb: 50,
    aiGenerating: false,
    aiPrompt: null,
  });

  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const volumeRef = useRef(overlayState.volume);

  useEffect(() => {
    volumeRef.current = overlayState.volume;
  }, [overlayState.volume]);

  const stopOverlay = useCallback(() => {
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch { /* already stopped */ }
    }
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.src = '';
      audioElRef.current = null;
    }
    if (mediaSourceRef.current) {
      mediaSourceRef.current = null;
    }
    if (ctxRef.current) {
      ctxRef.current.close();
    }
    sourceRef.current = null;
    ctxRef.current = null;
    gainRef.current = null;
    setOverlayState((prev) => ({ ...prev, isPlaying: false, aiGenerating: false }));
  }, []);

  const startOverlay = useCallback((soundType: SoundType, volume: number, targetDb: number) => {
    stopOverlay();

    if (soundType === 'ai-generated') {
      // AI generation handled by generateAiBed
      setOverlayState({ isPlaying: false, soundType, volume, targetDb, aiGenerating: false, aiPrompt: null });
      return;
    }

    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(ctx.destination);

    const buffer = createNoiseBuffer(ctx, soundType);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();

    ctxRef.current = ctx;
    sourceRef.current = source;
    gainRef.current = gain;

    setOverlayState({ isPlaying: true, soundType, volume, targetDb, aiGenerating: false, aiPrompt: null });
  }, [stopOverlay]);

  const generateAiBed = useCallback(async (
    mode: string,
    profile?: { eqGains: number[]; targetDb: number },
    userId: string = 'anon',
  ) => {
    stopOverlay();
    setOverlayState((prev) => ({ ...prev, soundType: 'ai-generated', aiGenerating: true, aiPrompt: null }));

    const defaultProfile = profile || {
      eqGains: [0.3, 0.5, 0.6, 0.4, 0.3, 0.2, 0.1],
      targetDb: 50,
    };

    try {
      const res = await fetch('/api/beds/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          profile: defaultProfile,
          mode,
          count: 1,
        }),
      });

      const data = await res.json();

      if (data.status === 'generated' && data.beds?.length > 0) {
        const bedUrl = data.beds[0].url;
        const prompt = data.beds[0].prompt;

        // Play the generated MP3
        const ctx = new AudioContext();
        const gain = ctx.createGain();
        gain.gain.value = volumeRef.current;
        gain.connect(ctx.destination);

        const audio = new Audio(bedUrl);
        audio.loop = true;
        audio.crossOrigin = 'anonymous';
        const mediaSource = ctx.createMediaElementSource(audio);
        mediaSource.connect(gain);

        ctxRef.current = ctx;
        gainRef.current = gain;
        audioElRef.current = audio;
        mediaSourceRef.current = mediaSource;

        await audio.play();

        setOverlayState((prev) => ({
          ...prev,
          isPlaying: true,
          soundType: 'ai-generated',
          targetDb: defaultProfile.targetDb,
          aiGenerating: false,
          aiPrompt: prompt,
        }));
      } else if (data.status === 'cached' && data.bedUrl) {
        const ctx = new AudioContext();
        const gain = ctx.createGain();
        gain.gain.value = volumeRef.current;
        gain.connect(ctx.destination);

        const audio = new Audio(data.bedUrl);
        audio.loop = true;
        audio.crossOrigin = 'anonymous';
        const mediaSource = ctx.createMediaElementSource(audio);
        mediaSource.connect(gain);

        ctxRef.current = ctx;
        gainRef.current = gain;
        audioElRef.current = audio;
        mediaSourceRef.current = mediaSource;

        await audio.play();

        setOverlayState((prev) => ({
          ...prev,
          isPlaying: true,
          soundType: 'ai-generated',
          targetDb: defaultProfile.targetDb,
          aiGenerating: false,
          aiPrompt: 'Using cached personalized bed',
        }));
      } else {
        // No API key or generation failed — show prompts
        setOverlayState((prev) => ({
          ...prev,
          aiGenerating: false,
          aiPrompt: data.samplePrompt || data.message || 'Generation unavailable',
        }));
      }
    } catch (error) {
      // Clean up resources allocated before audio.play() failed
      if (ctxRef.current) {
        try { ctxRef.current.close(); } catch { /* ignore */ }
      }
      if (audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current.src = '';
        audioElRef.current = null;
      }
      ctxRef.current = null;
      gainRef.current = null;
      mediaSourceRef.current = null;
      const msg = error instanceof Error ? error.message : 'Generation failed';
      setOverlayState((prev) => ({
        ...prev,
        aiGenerating: false,
        aiPrompt: `Error: ${msg}`,
      }));
    }
  }, [stopOverlay]);

  const setVolume = useCallback((volume: number) => {
    if (gainRef.current) {
      gainRef.current.gain.value = volume;
    }
    setOverlayState((prev) => ({ ...prev, volume }));
  }, []);

  const setSoundType = useCallback((soundType: SoundType) => {
    if (overlayState.isPlaying) {
      startOverlay(soundType, overlayState.volume, overlayState.targetDb);
    } else {
      setOverlayState((prev) => ({ ...prev, soundType }));
    }
  }, [overlayState.isPlaying, overlayState.volume, overlayState.targetDb, startOverlay]);

  return {
    overlayState,
    startOverlay,
    stopOverlay,
    setVolume,
    setSoundType,
    generateAiBed,
  };
}
