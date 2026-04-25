'use client';

import { useEffect, useRef } from 'react';

interface Props {
  frequencyData: number[];
  isActive: boolean;
}

export default function FrequencyVisualizer({ frequencyData, isActive }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    ctx.clearRect(0, 0, width, height);

    if (!isActive || frequencyData.length === 0) {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#4a4a6a';
      ctx.font = '14px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Enable microphone to see frequency analysis', width / 2, height / 2);
      return;
    }

    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, width, height);

    const barCount = Math.min(frequencyData.length, 64);
    const barWidth = width / barCount;
    const step = Math.floor(frequencyData.length / barCount);

    for (let i = 0; i < barCount; i++) {
      const value = frequencyData[i * step] / 255;
      const barHeight = value * height * 0.9;

      const hue = 200 + value * 160;
      const saturation = 70 + value * 30;
      const lightness = 30 + value * 40;

      const gradient = ctx.createLinearGradient(
        i * barWidth, height,
        i * barWidth, height - barHeight
      );
      gradient.addColorStop(0, `hsla(${hue}, ${saturation}%, ${lightness}%, 0.8)`);
      gradient.addColorStop(1, `hsla(${hue + 30}, ${saturation}%, ${lightness + 20}%, 0.6)`);

      ctx.fillStyle = gradient;
      ctx.fillRect(
        i * barWidth + 1,
        height - barHeight,
        barWidth - 2,
        barHeight
      );

      ctx.fillStyle = `hsla(${hue + 30}, 100%, 70%, ${value * 0.5})`;
      ctx.shadowColor = `hsla(${hue}, 100%, 60%, 0.5)`;
      ctx.shadowBlur = 10;
      ctx.fillRect(
        i * barWidth + 1,
        height - barHeight,
        barWidth - 2,
        2
      );
      ctx.shadowBlur = 0;
    }
  }, [frequencyData, isActive]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full rounded-lg"
      style={{ minHeight: '200px' }}
    />
  );
}
