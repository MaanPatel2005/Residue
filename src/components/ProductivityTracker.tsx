'use client';

import type { ProductivitySnapshot } from '@/types';

interface Props {
  snapshot: ProductivitySnapshot | null;
  history: ProductivitySnapshot[];
  screenPreview: string | null;
  isTracking: boolean;
  onStartTracking: () => void;
  onStopTracking: () => void;
  onSelfReport: (rating: number) => void;
  /**
   * Cumulative productivity penalty for the active session, sourced from
   * phone-distraction events classified on-device by Zetic Melange. Subtracted
   * from the screen-derived score so the displayed productivity reflects
   * real-world phone use during the session.
   */
  phonePenalty?: number;
}

export default function ProductivityTracker({
  snapshot,
  history,
  screenPreview,
  isTracking,
  onStartTracking,
  onStopTracking,
  onSelfReport,
  phonePenalty = 0,
}: Props) {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const adjustedCurrent = snapshot
    ? clamp(snapshot.productivityScore - phonePenalty)
    : 0;
  const avgProductivity =
    history.length > 0
      ? Math.round(
          history.reduce(
            (a, b) => a + clamp(b.productivityScore - phonePenalty),
            0,
          ) / history.length,
        )
      : 0;

  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-green-400';
    if (score >= 40) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getScoreBg = (score: number) => {
    if (score >= 70) return 'bg-green-500';
    if (score >= 40) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <div className="bg-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-800 p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-white">Productivity Tracker</h3>
        <button
          onClick={isTracking ? onStopTracking : onStartTracking}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            isTracking
              ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
              : 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30'
          }`}
        >
          {isTracking ? 'Stop Tracking' : 'Start Screen Tracking'}
        </button>
      </div>

      {isTracking && snapshot && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-800/50 rounded-lg p-4 text-center">
            <p className="text-xs text-gray-400 mb-1">
              Current Score
              {phonePenalty > 0 && (
                <span className="ml-1 text-red-400">(-{phonePenalty})</span>
              )}
            </p>
            <p className={`text-3xl font-bold ${getScoreColor(adjustedCurrent)}`}>
              {adjustedCurrent}
            </p>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-4 text-center">
            <p className="text-xs text-gray-400 mb-1">Avg Score</p>
            <p className={`text-3xl font-bold ${getScoreColor(avgProductivity)}`}>
              {avgProductivity}
            </p>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-4 text-center">
            <p className="text-xs text-gray-400 mb-1">Screen Activity</p>
            <p className={`text-3xl font-bold ${snapshot.screenChanged ? 'text-green-400' : 'text-red-400'}`}>
              {snapshot.changePercentage}%
            </p>
          </div>
        </div>
      )}

      {isTracking && (
        <div>
          <p className="text-sm text-gray-400 mb-2">How focused are you right now?</p>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => onSelfReport(n)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  snapshot?.selfReport === n
                    ? 'bg-cyan-500 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>Distracted</span>
            <span>Deep Focus</span>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div>
          <p className="text-sm text-gray-400 mb-2">
            Session Timeline ({history.length} snapshots)
          </p>
          <div className="flex gap-0.5 h-8 items-end">
            {history.slice(-40).map((s, i) => (
              <div
                key={i}
                className={`flex-1 rounded-t transition-all ${getScoreBg(s.productivityScore)}`}
                style={{
                  height: `${Math.max(4, s.productivityScore)}%`,
                  opacity: 0.4 + (s.productivityScore / 100) * 0.6,
                }}
                title={`Score: ${s.productivityScore} | Change: ${s.changePercentage}%`}
              />
            ))}
          </div>
        </div>
      )}

      {screenPreview && isTracking && (
        <div>
          <p className="text-xs text-gray-500 mb-1">Latest Capture (processed on-device)</p>
          <img
            src={screenPreview}
            alt="Screen capture"
            className="w-full rounded-lg border border-gray-700 opacity-60"
          />
        </div>
      )}
    </div>
  );
}
