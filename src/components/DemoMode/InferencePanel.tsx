'use client';

/**
 * Live readout for the on-device classifier + DSP latency badge.
 */

import type { DspLatencyReport } from '@/lib/types/acoustic';
import type { StateInferenceResult } from '@/lib/types/acoustic';

export interface InferencePanelProps {
  inference: StateInferenceResult | null;
  latency: DspLatencyReport | null;
}

export default function InferencePanel({ inference, latency }: InferencePanelProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 12,
      }}
    >
      <Card title="On-device state inference" hint={inference ? 'ONNX Runtime Web' : 'idle'}>
        {inference ? (
          <>
            <BigLabel value={inference.label.toUpperCase()} accent={labelColor(inference.label)} />
            <div style={{ marginTop: 8 }}>
              {(['focused', 'scattered', 'anxious', 'drowsy'] as const).map((k) => (
                <Bar key={k} label={k} value={inference.probabilities[k]} accent={labelColor(k)} />
              ))}
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: '#9aa0c8' }}>
              match-to-goal {(inference.matchToGoal * 100).toFixed(1)}% · inference {inference.inferenceMs.toFixed(1)}ms · {inference.executionProvider}
            </div>
          </>
        ) : (
          <div style={{ color: '#8a8aa8', fontSize: 12 }}>Waiting for first frame…</div>
        )}
      </Card>

      <Card title="DSP latency" hint="end-to-end (target <30ms)">
        {latency ? (
          <>
            <BigLabel
              value={`${latency.totalMs.toFixed(1)} ms`}
              accent={latency.totalMs < 30 ? '#a4ffb4' : '#ffb46a'}
            />
            <div style={{ marginTop: 6, fontSize: 11, color: '#9aa0c8', lineHeight: 1.6 }}>
              base {latency.baseMs.toFixed(2)}ms · output {latency.outputMs.toFixed(2)}ms · proc {latency.processingMs.toFixed(2)}ms
            </div>
          </>
        ) : (
          <div style={{ color: '#8a8aa8', fontSize: 12 }}>not measured yet</div>
        )}
      </Card>
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
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
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        {hint && <span style={{ fontSize: 11, color: '#8a8aa8' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function BigLabel({ value, accent }: { value: string; accent: string }) {
  return (
    <div style={{ fontSize: 22, fontWeight: 700, color: accent, fontVariantNumeric: 'tabular-nums' }}>
      {value}
    </div>
  );
}

function Bar({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9aa0c8' }}>
        <span>{label}</span>
        <span>{(value * 100).toFixed(0)}%</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: '#1a1a3a', marginTop: 2 }}>
        <div
          style={{
            width: `${Math.min(100, value * 100)}%`,
            height: '100%',
            borderRadius: 2,
            background: accent,
            transition: 'width 120ms linear',
          }}
        />
      </div>
    </div>
  );
}

function labelColor(label: string): string {
  switch (label) {
    case 'focused':
      return '#a4ffb4';
    case 'scattered':
      return '#ffd76a';
    case 'anxious':
      return '#ff8a8a';
    case 'drowsy':
      return '#8a8aff';
    default:
      return '#9aa0c8';
  }
}
