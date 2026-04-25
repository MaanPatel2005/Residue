/**
 * Single shared AudioContext for the Residue real-time pipeline.
 *
 * The hackathon MVP creates a fresh `AudioContext` inside each hook
 * (`useAudioCapture`, `useAudioOverlay`). For the real-time DSP demo we need
 * one context that owns the whole graph:
 *
 *   mic → preGain → EqualizerEngine → outputAnalyser → destination
 *                                  ↘ inputAnalyser (pre-EQ tap)
 *                BedPlayer ────────────────────────────↑
 *
 * Per the agent brief: "Build on top of the existing Web Audio context — do
 * not create a second one." This module enforces that by exposing a singleton
 * accessor used by the EqualizerEngine, FeatureExtractor, BedPlayer, and the
 * /demo route's visualisers.
 */

export interface AudioEngineHandles {
  /** Shared AudioContext. */
  ctx: AudioContext;
  /** Mic source (only present after `attachMicrophone`). */
  source: MediaStreamAudioSourceNode | null;
  /** Pre-EQ gain node — useful for fast mute/duck without rebuilding nodes. */
  preGain: GainNode;
  /** Pre-EQ analyser tap (for the "Raw" half of the spectrum compare). */
  inputAnalyser: AnalyserNode;
  /** Post-EQ analyser tap (for the "Optimal" half of the spectrum compare). */
  outputAnalyser: AnalyserNode;
  /** Bus the EqualizerEngine connects into and out of. */
  eqInput: GainNode;
  eqOutput: GainNode;
  /** Bus where ambient beds (BedPlayer) mix in. */
  bedBus: GainNode;
  /** Final output bus connected to ctx.destination. */
  masterOut: GainNode;
}

let handles: AudioEngineHandles | null = null;
let micStream: MediaStream | null = null;

const ANALYSER_FFT = 2048;

function buildHandles(ctx: AudioContext): AudioEngineHandles {
  const preGain = ctx.createGain();
  preGain.gain.value = 1;

  const inputAnalyser = ctx.createAnalyser();
  inputAnalyser.fftSize = ANALYSER_FFT;
  inputAnalyser.smoothingTimeConstant = 0.6;

  const outputAnalyser = ctx.createAnalyser();
  outputAnalyser.fftSize = ANALYSER_FFT;
  outputAnalyser.smoothingTimeConstant = 0.6;

  const eqInput = ctx.createGain();
  const eqOutput = ctx.createGain();

  const bedBus = ctx.createGain();
  bedBus.gain.value = 0; // muted until a bed starts

  const masterOut = ctx.createGain();
  masterOut.gain.value = 1;

  // Wire the static parts of the graph. The EqualizerEngine will splice its
  // filter chain between `eqInput` and `eqOutput`.
  preGain.connect(inputAnalyser);
  preGain.connect(eqInput);

  eqOutput.connect(outputAnalyser);
  eqOutput.connect(masterOut);

  bedBus.connect(masterOut);
  masterOut.connect(ctx.destination);

  return {
    ctx,
    source: null,
    preGain,
    inputAnalyser,
    outputAnalyser,
    eqInput,
    eqOutput,
    bedBus,
    masterOut,
  };
}

/** Get (or lazily create) the shared engine. Browser only. */
export function getAudioEngine(): AudioEngineHandles {
  if (typeof window === 'undefined') {
    throw new Error('AudioEngine is browser-only');
  }
  if (!handles) {
    // `latencyHint: 'interactive'` minimises buffer size; targets <30ms.
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    handles = buildHandles(ctx);
  }
  return handles;
}

/** Suspend/resume helpers — Safari needs an explicit resume after gesture. */
export async function ensureRunning(): Promise<void> {
  const h = getAudioEngine();
  if (h.ctx.state !== 'running') {
    await h.ctx.resume();
  }
}

/**
 * Acquire the microphone (no-op if already attached) and route it into the
 * engine. Returns the mic source node.
 */
export async function attachMicrophone(): Promise<MediaStreamAudioSourceNode> {
  const h = getAudioEngine();
  if (h.source) return h.source;

  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  const src = h.ctx.createMediaStreamSource(micStream);
  src.connect(h.preGain);
  h.source = src;
  return src;
}

/** Release the mic and tear the graph down. Useful for HMR / page unmount. */
export async function teardownAudioEngine(): Promise<void> {
  if (!handles) return;
  try {
    handles.source?.disconnect();
    handles.preGain.disconnect();
    handles.eqInput.disconnect();
    handles.eqOutput.disconnect();
    handles.bedBus.disconnect();
    handles.masterOut.disconnect();
    handles.inputAnalyser.disconnect();
    handles.outputAnalyser.disconnect();
  } catch {
    /* node was already disconnected */
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  await handles.ctx.close().catch(() => undefined);
  handles = null;
}

/** True if engine is constructed (does not allocate). */
export function isAudioEngineReady(): boolean {
  return handles !== null;
}
