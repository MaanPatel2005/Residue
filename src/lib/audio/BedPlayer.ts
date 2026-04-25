/**
 * Ambient-bed player for the /demo route.
 *
 * Agent B owns the ElevenLabs SFX call + MongoDB cache; we just consume the
 * URL. Contract:
 *   - Read `ResidueState.activeBedUrl` (string | null) from the shared store.
 *   - If non-null: load the MP3, equal-power crossfade from the previous bed
 *     (if any), and duck/swell based on environment loudness.
 *   - If null: fall back to one of the synthesized soundscapes already in
 *     `useAudioOverlay` (we generate brown noise here so we don't have to
 *     touch that hook).
 *
 * Routes audio into the shared engine's `bedBus` so it sits behind the live
 * mic + EQ chain in the master mix.
 */

import { getAudioEngine } from '@/lib/audio/AudioEngine';
import { getResidueStore } from '@/lib/audio/sharedStore';

const CROSSFADE_S = 1.5;
const DUCK_TARGET_DB = 65; // start ducking when env exceeds this
const DUCK_FLOOR = 0.2;

export class BedPlayer {
  private current: { source: AudioNode; gain: GainNode } | null = null;
  private prev: { source: AudioNode; gain: GainNode } | null = null;
  private currentUrl: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private duckTimer: ReturnType<typeof setInterval> | null = null;
  private bedVolume = 0.6;

  start(): void {
    const eng = getAudioEngine();
    eng.bedBus.gain.setTargetAtTime(this.bedVolume, eng.ctx.currentTime, 0.05);

    const store = getResidueStore();
    this.unsubscribe = store.subscribe((s) => {
      if (s.activeBedUrl !== this.currentUrl) {
        this.swapTo(s.activeBedUrl).catch((err) => {
          console.error('[BedPlayer] swap failed', err);
        });
      }
    });

    // Ducking loop — react to environment loudness at 5Hz.
    this.duckTimer = setInterval(() => this.applyDucking(), 200);
  }

  stop(): void {
    const eng = getAudioEngine();
    eng.bedBus.gain.setTargetAtTime(0, eng.ctx.currentTime, 0.05);
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.duckTimer) {
      clearInterval(this.duckTimer);
      this.duckTimer = null;
    }
    this.disposeBed(this.current);
    this.disposeBed(this.prev);
    this.current = null;
    this.prev = null;
    this.currentUrl = null;
  }

  setVolume(v: number): void {
    this.bedVolume = Math.max(0, Math.min(1, v));
    const eng = getAudioEngine();
    eng.bedBus.gain.setTargetAtTime(this.bedVolume, eng.ctx.currentTime, 0.05);
  }

  private async swapTo(url: string | null): Promise<void> {
    const eng = getAudioEngine();

    // Move current → prev for fade-out.
    if (this.current) {
      this.prev = this.current;
      const t = eng.ctx.currentTime;
      // Equal-power fade-out: cos curve from 1 → 0 over CROSSFADE_S.
      this.prev.gain.gain.cancelScheduledValues(t);
      this.prev.gain.gain.setValueAtTime(this.prev.gain.gain.value, t);
      this.prev.gain.gain.linearRampToValueAtTime(0, t + CROSSFADE_S);
      const toStop = this.prev;
      setTimeout(() => this.disposeBed(toStop), (CROSSFADE_S + 0.1) * 1000);
    }

    if (url) {
      const node = await this.loadUrlAsLoop(url);
      this.current = node;
    } else {
      // Fallback: synthesised brown-noise bed inside the same engine.
      this.current = this.buildBrownNoiseFallback();
    }

    const t = eng.ctx.currentTime;
    this.current.gain.gain.setValueAtTime(0, t);
    this.current.gain.gain.linearRampToValueAtTime(1, t + CROSSFADE_S);
    this.currentUrl = url;
  }

  private async loadUrlAsLoop(
    url: string,
  ): Promise<{ source: AudioNode; gain: GainNode }> {
    const eng = getAudioEngine();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`bed fetch failed: ${res.status}`);
    const buf = await res.arrayBuffer();
    const audioBuffer = await eng.ctx.decodeAudioData(buf);

    const source = eng.ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.loop = true;

    const gain = eng.ctx.createGain();
    source.connect(gain);
    gain.connect(eng.bedBus);
    source.start();
    return { source, gain };
  }

  private buildBrownNoiseFallback(): { source: AudioNode; gain: GainNode } {
    const eng = getAudioEngine();
    const sampleRate = eng.ctx.sampleRate;
    const duration = 4;
    const length = sampleRate * duration;
    const buffer = eng.ctx.createBuffer(2, length, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      }
    }
    const source = eng.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = eng.ctx.createGain();
    source.connect(gain);
    gain.connect(eng.bedBus);
    source.start();
    return { source, gain };
  }

  private disposeBed(b: { source: AudioNode; gain: GainNode } | null): void {
    if (!b) return;
    try {
      if ('stop' in b.source && typeof b.source.stop === 'function') {
        (b.source as AudioBufferSourceNode).stop();
      }
      b.source.disconnect();
      b.gain.disconnect();
    } catch {
      /* already torn down */
    }
  }

  private applyDucking(): void {
    if (!this.current) return;
    const eng = getAudioEngine();
    const frame = typeof window !== 'undefined' ? window.__residueAcousticFeatures : null;
    const envDb = frame?.overallDb ?? 0;
    // Linear duck: at DUCK_TARGET_DB, full bed; at DUCK_TARGET_DB+20, DUCK_FLOOR.
    const overshoot = Math.max(0, envDb - DUCK_TARGET_DB);
    const factor = Math.max(DUCK_FLOOR, 1 - overshoot / 20);
    eng.bedBus.gain.setTargetAtTime(
      this.bedVolume * factor,
      eng.ctx.currentTime,
      0.1,
    );
  }
}
