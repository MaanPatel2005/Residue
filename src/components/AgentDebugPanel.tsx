'use client';

import { useState, useEffect } from 'react';
import type { PerceptionState, InterventionCommand, BehavioralFeatureVector } from '@/lib/types/agents';

export default function AgentDebugPanel() {
  const [perception, setPerception] = useState<PerceptionState | null>(null);
  const [intervention, setIntervention] = useState<InterventionCommand | null>(null);
  const [behavior, setBehavior] = useState<BehavioralFeatureVector | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof window === 'undefined') return;
      setPerception(window.__residuePerception ?? null);
      setIntervention(window.__residueIntervention ?? null);
      setBehavior(window.__residueBehavior ?? null);
    }, 500);

    return () => clearInterval(interval);
  }, []);

  const stateColor: Record<string, string> = {
    focused: 'text-green-400',
    distracted: 'text-red-400',
    idle: 'text-gray-400',
    transitioning: 'text-yellow-400',
  };

  return (
    <div className="bg-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-800 p-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex justify-between items-center w-full text-left"
      >
        <h3 className="text-sm font-semibold text-gray-300">Agent System</h3>
        <div className="flex items-center gap-2">
          {perception && (
            <span className={`text-xs font-mono ${stateColor[perception.cognitiveState] ?? 'text-gray-500'}`}>
              {perception.cognitiveState}
            </span>
          )}
          <svg
            className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 text-xs">
          {/* Perception Agent */}
          <div className="bg-gray-800/50 rounded p-3">
            <p className="text-gray-400 font-medium mb-1">PerceptionAgent</p>
            {perception ? (
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-500">State:</span>
                  <span className={stateColor[perception.cognitiveState] ?? 'text-gray-400'}>
                    {perception.cognitiveState}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Confidence:</span>
                  <span className="text-cyan-400">{Math.round(perception.confidence * 100)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Acoustic dB:</span>
                  <span className="text-white">{perception.acoustic?.overallDb?.toFixed(1) ?? '—'}</span>
                </div>
              </div>
            ) : (
              <p className="text-gray-600">Not running</p>
            )}
          </div>

          {/* Behavioral Vector */}
          <div className="bg-gray-800/50 rounded p-3">
            <p className="text-gray-400 font-medium mb-1">BehaviorTracker</p>
            {behavior ? (
              <div className="grid grid-cols-2 gap-1">
                <div className="flex justify-between">
                  <span className="text-gray-500">WPM:</span>
                  <span className="text-white font-mono">{behavior.typingSpeed.toFixed(0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Errors/m:</span>
                  <span className="text-white font-mono">{behavior.errorRate.toFixed(1)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Latency:</span>
                  <span className="text-white font-mono">{behavior.interKeyLatency.toFixed(0)}ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Jitter:</span>
                  <span className="text-white font-mono">{behavior.mouseJitter.toFixed(1)}px</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Scroll:</span>
                  <span className="text-white font-mono">{behavior.scrollVelocity.toFixed(0)}px/s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Switches:</span>
                  <span className="text-white font-mono">{behavior.focusSwitchRate}/min</span>
                </div>
              </div>
            ) : (
              <p className="text-gray-600">Not running</p>
            )}
          </div>

          {/* Intervention Agent */}
          <div className="bg-gray-800/50 rounded p-3">
            <p className="text-gray-400 font-medium mb-1">InterventionAgent</p>
            {intervention ? (
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-500">Goal:</span>
                  <span className="text-purple-400">{intervention.goalMode}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Bed:</span>
                  <span className="text-white">{intervention.bedSelection}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Gap:</span>
                  <span className={intervention.gapAnalysis.delta > 0 ? 'text-yellow-400' : 'text-green-400'}>
                    {intervention.gapAnalysis.delta > 0 ? '+' : ''}
                    {intervention.gapAnalysis.delta.toFixed(1)} dB
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-gray-600">Not running</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
