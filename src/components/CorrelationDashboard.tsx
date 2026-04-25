'use client';

import type { UserProfile, AcousticStateCorrelation } from '@/types';

interface Props {
  profile: UserProfile | null;
  correlations: AcousticStateCorrelation[];
}

export default function CorrelationDashboard({ profile, correlations }: Props) {
  if (!profile && correlations.length < 3) {
    return (
      <div className="bg-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-800 p-6">
        <h3 className="text-lg font-semibold text-white mb-3">Your Acoustic Profile</h3>
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <p className="text-gray-400 text-sm">
            Collecting data... ({correlations.length}/3 samples needed)
          </p>
          <p className="text-gray-500 text-xs mt-1">
            Keep your mic and screen tracking active to build your profile
          </p>
          <div className="w-48 mx-auto mt-3 h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-cyan-500 rounded-full transition-all"
              style={{ width: `${(correlations.length / 3) * 100}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="bg-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-800 p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-white">Your Acoustic Profile</h3>
        <span className="text-xs text-gray-400">
          {profile.totalSessions} data points
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gray-800/50 rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-1">Optimal Volume Range</p>
          <p className="text-2xl font-bold text-cyan-400">
            {profile.optimalDbRange[0]}-{profile.optimalDbRange[1]}
            <span className="text-sm text-gray-400 ml-1">dB</span>
          </p>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-1">Sessions Analyzed</p>
          <p className="text-2xl font-bold text-purple-400">{profile.totalSessions}</p>
        </div>
      </div>

      <div>
        <p className="text-sm text-gray-400 mb-2">Productivity by Volume Level</p>
        <div className="flex items-end gap-1 h-24">
          {profile.productivityByEnvironment.map((env, i) => {
            const height = Math.max(4, env.avgProductivity);
            const isOptimal =
              env.dbLevel >= profile.optimalDbRange[0] &&
              env.dbLevel <= profile.optimalDbRange[1];
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className={`w-full rounded-t transition-all ${
                    isOptimal ? 'bg-cyan-500' : 'bg-gray-600'
                  }`}
                  style={{ height: `${height}%` }}
                  title={`${env.dbLevel}dB: ${env.avgProductivity}% avg productivity (${env.sampleCount} samples)`}
                />
                <span className="text-[10px] text-gray-500">{env.dbLevel}</span>
              </div>
            );
          })}
        </div>
        <p className="text-center text-xs text-gray-500 mt-1">dB Level</p>
      </div>

      {profile.optimalFrequencyProfile.length > 0 && (
        <div>
          <p className="text-sm text-gray-400 mb-2">Optimal Frequency Profile</p>
          <div className="space-y-1">
            {profile.optimalFrequencyProfile.map((band, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-20 truncate">{band.label}</span>
                <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-cyan-500 rounded-full"
                    style={{ width: `${band.magnitude * 100}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500 w-8 text-right">
                  {Math.round(band.magnitude * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
