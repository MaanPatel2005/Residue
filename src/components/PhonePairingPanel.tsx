'use client';

import type { PairingDTO, PhoneStateDTO } from '@/hooks/usePhoneCompanion';

interface Props {
  signedIn: boolean;
  sessionActive: boolean;
  pairing: PairingDTO | null;
  state: PhoneStateDTO | null;
  error: string | null;
  onStartPairing: () => void;
}

function formatMs(ms: number): string {
  if (ms <= 0) return '0s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m${rs.toString().padStart(2, '0')}s`;
}

const LABEL_COPY: Record<
  'glance' | 'off_task' | 'break_needed' | 'unknown',
  string
> = {
  glance: 'Brief glance',
  off_task: 'Off task',
  break_needed: 'Break needed',
  unknown: 'Unclassified',
};

const LABEL_COLORS: Record<
  'glance' | 'off_task' | 'break_needed' | 'unknown',
  string
> = {
  glance: 'text-yellow-300',
  off_task: 'text-red-400',
  break_needed: 'text-cyan-300',
  unknown: 'text-gray-300',
};

export default function PhonePairingPanel({
  signedIn,
  sessionActive,
  pairing,
  state,
  error,
  onStartPairing,
}: Props) {
  return (
    <div className="bg-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-800 p-6 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Phone Companion</h3>
        {state?.paired ? (
          <span className="text-xs px-2 py-1 rounded-full bg-green-500/15 text-green-300 border border-green-500/30">
            paired
          </span>
        ) : (
          <span className="text-xs px-2 py-1 rounded-full bg-gray-800/60 text-gray-400 border border-gray-700">
            not paired
          </span>
        )}
      </div>

      {!signedIn && (
        <p className="text-sm text-gray-400">
          Sign in to pair your phone. The desktop and the phone must be on the same
          account.
        </p>
      )}

      {signedIn && !sessionActive && (
        <p className="text-sm text-gray-400">
          Start a study session to generate a pairing code.
        </p>
      )}

      {signedIn && sessionActive && !pairing && (
        <button
          type="button"
          onClick={onStartPairing}
          className="text-sm px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-purple-600 text-white"
        >
          Generate pairing code
        </button>
      )}

      {signedIn && pairing && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-gray-500">
            Open the Residue iOS app and enter:
          </p>
          <p
            className="text-4xl font-mono tracking-[0.4em] text-cyan-300"
            aria-label="pairing code"
          >
            {pairing.code}
          </p>
          <p className="text-xs text-gray-500">
            Expires {new Date(pairing.expiresAt).toLocaleTimeString()}
          </p>
        </div>
      )}

      {state && (
        <div className="grid grid-cols-3 gap-3 pt-2 border-t border-gray-800">
          <div className="bg-gray-800/40 rounded-lg p-3 text-center">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">
              opens
            </p>
            <p className="text-2xl font-bold text-white">{state.openCount}</p>
          </div>
          <div className="bg-gray-800/40 rounded-lg p-3 text-center">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">
              distracted
            </p>
            <p className="text-2xl font-bold text-white">
              {formatMs(state.totalDistractionMs)}
            </p>
          </div>
          <div className="bg-gray-800/40 rounded-lg p-3 text-center">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">
              penalty
            </p>
            <p className="text-2xl font-bold text-red-300">
              -{state.productivityPenalty}
            </p>
          </div>
        </div>
      )}

      {state?.lastInference && (
        <div className="text-xs text-gray-400 flex items-center gap-2">
          <span>Last unlock:</span>
          <span className={LABEL_COLORS[state.lastInference.label]}>
            {LABEL_COPY[state.lastInference.label]}
          </span>
          <span className="text-gray-600">
            ({state.lastInference.executionProvider},{' '}
            {state.lastInference.inferenceMs.toFixed(1)}ms)
          </span>
        </div>
      )}

      {state?.report && (
        <div className="pt-3 border-t border-gray-800 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-gray-500">
              On-device distraction report
            </p>
            <span
              className="text-[10px] text-purple-300"
              title={`Generated on Apple Neural Engine via ${state.report.modelKey}`}
            >
              ANE · {state.report.modelKey}
            </span>
          </div>
          <p className="text-sm text-gray-200 whitespace-pre-wrap">
            {state.report.summary}
          </p>
          {Object.keys(state.report.perCategoryMinutes).length > 0 && (
            <div className="grid grid-cols-2 gap-1 text-xs">
              {Object.entries(state.report.perCategoryMinutes)
                .sort(([, a], [, b]) => b - a)
                .map(([cat, mins]) => (
                  <div
                    key={cat}
                    className="bg-gray-800/40 rounded px-2 py-1 flex justify-between"
                  >
                    <span className="text-gray-400 capitalize">{cat}</span>
                    <span className="text-gray-200 font-mono">
                      {mins.toFixed(1)}m
                    </span>
                  </div>
                ))}
            </div>
          )}
          <p className="text-[10px] text-gray-600">
            {state.report.completionTokens} tokens ·{' '}
            {state.report.inferenceMs.toFixed(0)}ms on-device
          </p>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
