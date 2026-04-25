'use client';

/**
 * Generic real-time spectrum visualiser for an `AnalyserNode`.
 *
 * Drawn on a single `<canvas>` with `requestAnimationFrame` so we can pack a
 * pre-EQ + post-EQ split-screen view into ~1ms of CPU per frame on a 2020
 * MacBook Air target.
 *
 * Used by `SpectrumCompare` (input vs output) and the homepage debug panel.
 */

import { useEffect, useRef } from 'react';

export interface AudioVisualizerProps {
  /** AnalyserNode to read FFT data from. */
  analyser: AnalyserNode | null;
  /** Display label rendered on top-left. */
  label?: string;
  /** Hex colour used for the bars + line. */
  color?: string;
  /** CSS height. */
  height?: number;
  /** Optional fixed max bin count. Default 96. */
  bins?: number;
  /** Show waveform overlay on top of the bars. */
  showWaveform?: boolean;
}

export default function AudioVisualizer({
  analyser,
  label,
  color = '#6ad6ff',
  height = 180,
  bins = 96,
  showWaveform = true,
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let freqData: Uint8Array<ArrayBuffer> | null = null;
    let timeData: Uint8Array<ArrayBuffer> | null = null;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      // Background.
      ctx.fillStyle = '#0a0a1a';
      ctx.fillRect(0, 0, w, h);

      if (!analyser) {
        ctx.fillStyle = '#4a4a6a';
        ctx.font = '12px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('analyser not ready', w / 2, h / 2);
        if (label) drawLabel(ctx, label, color);
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      if (!freqData || freqData.length !== analyser.frequencyBinCount) {
        freqData = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
      }
      if (!timeData || timeData.length !== analyser.fftSize) {
        timeData = new Uint8Array(analyser.fftSize) as Uint8Array<ArrayBuffer>;
      }
      analyser.getByteFrequencyData(freqData);

      // Bars.
      const barCount = Math.min(bins, freqData.length);
      const step = Math.floor(freqData.length / barCount);
      const barW = w / barCount;
      for (let i = 0; i < barCount; i++) {
        const v = freqData[i * step] / 255;
        const barH = v * h * 0.95;
        const grad = ctx.createLinearGradient(0, h - barH, 0, h);
        grad.addColorStop(0, color);
        grad.addColorStop(1, '#0a0a1a');
        ctx.fillStyle = grad;
        ctx.fillRect(i * barW + 1, h - barH, barW - 2, barH);
      }

      // Waveform overlay.
      if (showWaveform) {
        analyser.getByteTimeDomainData(timeData);
        ctx.beginPath();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `${color}aa`;
        const len = timeData.length;
        for (let i = 0; i < len; i++) {
          const x = (i / len) * w;
          const y = (timeData[i] / 255) * h;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      if (label) drawLabel(ctx, label, color);
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [analyser, label, color, bins, showWaveform]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: `${height}px`, display: 'block', borderRadius: 8 }}
    />
  );
}

function drawLabel(ctx: CanvasRenderingContext2D, label: string, color: string): void {
  ctx.save();
  ctx.font = '600 11px system-ui';
  ctx.textBaseline = 'top';
  ctx.fillStyle = `${color}cc`;
  ctx.fillText(label.toUpperCase(), 8, 8);
  ctx.restore();
}
