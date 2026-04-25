'use client';

import type { BayesianProfile } from '@/lib/types/profile';

interface Props {
  profile: BayesianProfile | null;
}

export default function ProfileDashboard({ profile }: Props) {
  if (!profile || profile.totalObservations < 1) {
    return (
      <div className="bg-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-800 p-6">
        <h3 className="text-lg font-semibold text-white mb-3">Bayesian Acoustic Profile</h3>
        <div className="text-center py-6">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-gray-800 flex items-center justify-center">
            <svg className="w-7 h-7 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <p className="text-gray-400 text-sm">Building your acoustic profile...</p>
          <p className="text-gray-500 text-xs mt-1">
            Keep your session active to collect data points
          </p>
        </div>
      </div>
    );
  }

  const { posterior, confidence, totalObservations, confounders } = profile;
  const dbMean = Math.round(posterior.optimalDb.mean);
  const dbStd = Math.round(Math.sqrt(posterior.optimalDb.variance));

  return (
    <div className="bg-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-800 p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-white">Bayesian Acoustic Profile</h3>
        <span className="text-xs text-gray-400">{totalObservations} observations</span>
      </div>

      {/* Confidence Summary */}
      <div className="bg-gray-800/50 rounded-lg p-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-gray-300">Overall Confidence</span>
          <span className="text-sm font-mono text-cyan-400">
            {Math.round(confidence.overall * 100)}%
          </span>
        </div>
        <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${confidence.overall * 100}%`,
              background: `linear-gradient(90deg, #06b6d4, ${confidence.overall > 0.7 ? '#10b981' : '#eab308'})`,
            }}
          />
        </div>
        {confidence.sessionsNeeded > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            ~{confidence.sessionsNeeded} more sessions for high confidence
          </p>
        )}
      </div>

      {/* Optimal dB with Confidence Interval */}
      <div className="bg-gray-800/50 rounded-lg p-4">
        <p className="text-sm text-gray-300 mb-2">Optimal Volume Range</p>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-white">{dbMean} dB</span>
          <span className="text-sm text-gray-400">± {dbStd} dB</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          We are{' '}
          <span className="text-cyan-400 font-medium">
            {Math.round(confidence.dbEstimate * 100)}% confident
          </span>{' '}
          your optimal dB range is{' '}
          <span className="font-mono">
            {confidence.intervalLow}-{confidence.intervalHigh} dB
          </span>
          , based on {totalObservations} sessions.
        </p>
      </div>

      {/* EQ Profile */}
      <div className="bg-gray-800/50 rounded-lg p-4">
        <p className="text-sm text-gray-300 mb-3">Optimal EQ Profile</p>
        <div className="flex items-end gap-1 h-24">
          {posterior.eqGains.map((band, i) => {
            const labels = ['Sub', 'Bass', 'Low', 'Mid', 'Up', 'Pres', 'Air'];
            const height = Math.max(5, band.mean * 100);
            const confWidth = Math.sqrt(band.variance) * 100;
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="relative w-full flex justify-center">
                  {/* Confidence interval bar (lighter) */}
                  <div
                    className="absolute bg-cyan-500/20 rounded-t"
                    style={{
                      height: `${Math.min(100, height + confWidth)}px`,
                      width: '60%',
                      bottom: 0,
                    }}
                  />
                  {/* Mean bar */}
                  <div
                    className="relative bg-cyan-500/60 rounded-t"
                    style={{ height: `${Math.min(96, height)}px`, width: '40%' }}
                  />
                </div>
                <span className="text-[10px] text-gray-500">{labels[i]}</span>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          EQ confidence:{' '}
          <span className="text-cyan-400">
            {Math.round(confidence.eqEstimate * 100)}%
          </span>
        </p>
      </div>

      {/* Productivity Curve */}
      {posterior.productivityCurve.length > 0 && (
        <div className="bg-gray-800/50 rounded-lg p-4">
          <p className="text-sm text-gray-300 mb-3">Productivity by Volume</p>
          <div className="flex items-end gap-0.5 h-16">
            {posterior.productivityCurve.map((point, i) => {
              const height = Math.max(2, (point.expectedProductivity / 100) * 64);
              const opacity = Math.min(1, point.n / 5);
              return (
                <div key={i} className="flex-1 flex flex-col items-center">
                  <div
                    className="w-full rounded-t transition-all"
                    style={{
                      height: `${height}px`,
                      backgroundColor: `rgba(6, 182, 212, ${opacity})`,
                    }}
                  />
                  <span className="text-[9px] text-gray-600 mt-0.5">{point.db}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Confounder Insights */}
      {confounders.timeOfDay.length > 0 && (
        <div className="bg-gray-800/50 rounded-lg p-4">
          <p className="text-sm text-gray-300 mb-2">Time-of-Day Insights</p>
          <div className="flex flex-wrap gap-2">
            {confounders.timeOfDay
              .filter((t) => t.n >= 2)
              .sort((a, b) => b.productivityMod - a.productivityMod)
              .slice(0, 4)
              .map((t) => (
                <span
                  key={t.hour}
                  className="text-xs px-2 py-1 bg-gray-700/50 rounded text-gray-300"
                >
                  {t.hour}:00 →{' '}
                  <span className={t.productivityMod > 1 ? 'text-green-400' : 'text-yellow-400'}>
                    {t.productivityMod > 1 ? '+' : ''}
                    {Math.round((t.productivityMod - 1) * 100)}%
                  </span>
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
