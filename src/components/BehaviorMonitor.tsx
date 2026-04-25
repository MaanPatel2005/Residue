'use client';

import { useState, useEffect } from 'react';
import type { BehavioralFeatureVector } from '@/lib/types/agents';

export default function BehaviorMonitor() {
  const [behavior, setBehavior] = useState<BehavioralFeatureVector | null>(null);
  const [history, setHistory] = useState<BehavioralFeatureVector[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof window === 'undefined') return;
      const vec = window.__residueBehavior ?? null;
      if (vec) {
        setBehavior(vec);
        setHistory((prev) => [...prev.slice(-60), vec]);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const dims = [
    { key: 'typingSpeed', label: 'Typing Speed', unit: 'WPM', max: 100, color: '#06b6d4' },
    { key: 'errorRate', label: 'Error Rate', unit: '/min', max: 20, color: '#ef4444' },
    { key: 'interKeyLatency', label: 'Key Latency', unit: 'ms', max: 500, color: '#eab308' },
    { key: 'mouseJitter', label: 'Mouse Jitter', unit: 'px', max: 30, color: '#8b5cf6' },
    { key: 'scrollVelocity', label: 'Scroll Speed', unit: 'px/s', max: 500, color: '#10b981' },
    { key: 'focusSwitchRate', label: 'Focus Switches', unit: '/min', max: 15, color: '#f97316' },
  ] as const;

  return (
    <div className="bg-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-800 p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-white">Behavioral Telemetry</h3>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${behavior ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
          <span className="text-xs text-gray-400">
            {behavior ? 'Live' : 'Inactive'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {dims.map((dim) => {
          const value = behavior ? behavior[dim.key] : 0;
          const pct = Math.min(100, (value / dim.max) * 100);

          return (
            <div key={dim.key} className="bg-gray-800/50 rounded-lg p-3">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-gray-400">{dim.label}</span>
                <span className="text-xs font-mono text-white">
                  {value.toFixed(dim.key === 'interKeyLatency' ? 0 : 1)}
                  <span className="text-gray-500 ml-0.5">{dim.unit}</span>
                </span>
              </div>
              <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: dim.color,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Mini sparkline for typing speed history */}
      {history.length > 1 && (
        <div className="mt-4">
          <p className="text-xs text-gray-500 mb-1">Typing Speed History (60s)</p>
          <div className="flex items-end gap-px h-8">
            {history.map((h, i) => {
              const height = Math.max(1, (h.typingSpeed / 100) * 32);
              return (
                <div
                  key={i}
                  className="flex-1 bg-cyan-500/40 rounded-t"
                  style={{ height: `${height}px` }}
                />
              );
            })}
          </div>
        </div>
      )}

      <p className="text-[10px] text-gray-600 mt-3">
        Privacy: Only timing data is captured. No keystroke content is ever recorded.
      </p>
    </div>
  );
}
