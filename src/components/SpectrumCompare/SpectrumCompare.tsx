'use client';

/**
 * Side-by-side input vs output spectrum view.
 *
 * The judge needs to *see* the EQ shaping, not just hear it. We pull the
 * pre-EQ analyser (raw mic) and post-EQ analyser (after the BiquadFilter
 * chain) directly from the shared `AudioEngine` and render them in the same
 * grid for visual diffing.
 */

import { useEffect, useState } from 'react';
import AudioVisualizer from '@/components/AudioVisualizer/AudioVisualizer';
import { getAudioEngine, isAudioEngineReady } from '@/lib/audio/AudioEngine';

export interface SpectrumCompareProps {
  /** Vertical or horizontal layout. */
  layout?: 'horizontal' | 'vertical';
  /** Override per-pane height. */
  paneHeight?: number;
}

export default function SpectrumCompare({
  layout = 'horizontal',
  paneHeight = 200,
}: SpectrumCompareProps) {
  const [input, setInput] = useState<AnalyserNode | null>(null);
  const [output, setOutput] = useState<AnalyserNode | null>(null);

  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      if (cancelled) return;
      if (isAudioEngineReady()) {
        const eng = getAudioEngine();
        setInput(eng.inputAnalyser);
        setOutput(eng.outputAnalyser);
      } else {
        // poll until the engine is built
        setTimeout(sync, 100);
      }
    };
    sync();
    return () => {
      cancelled = true;
    };
  }, []);

  const containerStyle: React.CSSProperties = {
    display: 'grid',
    gap: 12,
    gridTemplateColumns: layout === 'horizontal' ? '1fr 1fr' : '1fr',
  };

  return (
    <div style={containerStyle}>
      <Pane title="Raw input" subtitle="pre-EQ mic stream">
        <AudioVisualizer
          analyser={input}
          label="INPUT"
          color="#6ad6ff"
          height={paneHeight}
        />
      </Pane>
      <Pane title="Shaped output" subtitle="post-EQ → speakers">
        <AudioVisualizer
          analyser={output}
          label="OUTPUT"
          color="#a4ffb4"
          height={paneHeight}
        />
      </Pane>
    </div>
  );
}

function Pane({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: '#11112a',
        borderRadius: 12,
        padding: 12,
        border: '1px solid #22224a',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 11, color: '#8a8aa8' }}>{subtitle}</span>
      </div>
      {children}
    </div>
  );
}
