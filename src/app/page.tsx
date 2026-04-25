'use client';

import { useState, useEffect, useCallback } from 'react';
import FrequencyVisualizer from '@/components/FrequencyVisualizer';
import DbMeter from '@/components/DbMeter';
import ProductivityTracker from '@/components/ProductivityTracker';
import AudioOverlayControl from '@/components/AudioOverlayControl';
import CorrelationDashboard from '@/components/CorrelationDashboard';
import StudyBuddyFinder from '@/components/StudyBuddyFinder';
import ModeSelector from '@/components/ModeSelector';
import { useAudioCapture } from '@/hooks/useAudioCapture';
import { useScreenCapture } from '@/hooks/useScreenCapture';
import { useAudioOverlay } from '@/hooks/useAudioOverlay';
import {
  createCorrelation,
  analyzeCorrelations,
  getRecommendation,
} from '@/lib/correlationEngine';
import type { AcousticStateCorrelation, UserProfile } from '@/types';

export default function Home() {
  const [currentMode, setCurrentMode] = useState<'focus' | 'calm' | 'creative' | 'social'>('focus');
  const [correlations, setCorrelations] = useState<AcousticStateCorrelation[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionDuration, setSessionDuration] = useState(0);

  const {
    isListening,
    currentProfile: acousticProfile,
    rawFrequencyData,
    startListening,
    stopListening,
  } = useAudioCapture();

  const {
    isTracking,
    currentSnapshot,
    productivityHistory,
    screenPreview,
    startTracking,
    stopTracking,
    submitSelfReport,
  } = useScreenCapture();

  const {
    overlayState,
    startOverlay,
    stopOverlay,
    setVolume,
    setSoundType,
    generateAiBed,
  } = useAudioOverlay();

  const handleStartSession = useCallback(async () => {
    await startListening();
    setSessionActive(true);
    setSessionDuration(0);
  }, [startListening]);

  const handleStopSession = useCallback(() => {
    stopListening();
    stopTracking();
    stopOverlay();
    setSessionActive(false);
  }, [stopListening, stopTracking, stopOverlay]);

  useEffect(() => {
    if (!sessionActive) return;
    const interval = setInterval(() => {
      setSessionDuration((d) => d + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionActive]);

  useEffect(() => {
    if (acousticProfile && currentSnapshot) {
      const corr = createCorrelation(acousticProfile, currentSnapshot, 'user-1');
      setCorrelations((prev) => {
        const next = [...prev, corr].slice(-200);
        const newProfile = analyzeCorrelations(next);
        if (newProfile) setProfile(newProfile);
        return next;
      });

      // Persist snapshot to MongoDB (fire-and-forget)
      fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'user-1',
          mode: currentMode,
          acoustic_features: {
            overallDb: acousticProfile.overallDb,
            frequencyBands: acousticProfile.frequencyBands,
            dominantFrequency: acousticProfile.dominantFrequency,
            spectralCentroid: acousticProfile.spectralCentroid,
          },
          behavioral_features: null,
          productivity_score: currentSnapshot.productivityScore,
          state: currentSnapshot.productivityScore > 70 ? 'focused' : currentSnapshot.productivityScore > 40 ? 'normal' : 'distracted',
          goal: currentMode,
        }),
      }).catch(() => { /* MongoDB may be unavailable */ });
    }
  }, [currentSnapshot]);

  const recommendation =
    profile && acousticProfile ? getRecommendation(profile, acousticProfile) : null;

  const formatDuration = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <main className="min-h-screen bg-[#0a0a1a] text-white">
      {/* Header */}
      <header className="border-b border-gray-800/50 bg-gray-900/30 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
                Residue
              </h1>
              <p className="text-xs text-gray-500">Personalized Acoustic Intelligence</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {sessionActive && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800/50 rounded-lg">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                <span className="text-sm font-mono text-gray-300">
                  {formatDuration(sessionDuration)}
                </span>
              </div>
            )}
            <button
              onClick={sessionActive ? handleStopSession : handleStartSession}
              className={`px-5 py-2 rounded-lg font-medium text-sm transition-all ${
                sessionActive
                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30'
                  : 'bg-gradient-to-r from-cyan-500 to-purple-600 text-white hover:opacity-90'
              }`}
            >
              {sessionActive ? 'End Session' : 'Start Session'}
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Mode Selector */}
        <ModeSelector currentMode={currentMode} onModeChange={setCurrentMode} />

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Audio Analysis */}
          <div className="lg:col-span-2 space-y-6">
            {/* Frequency Visualizer */}
            <div className="bg-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-800 p-6">
              <h3 className="text-lg font-semibold text-white mb-3">
                Acoustic Environment
                {isListening && (
                  <span className="ml-2 text-xs text-green-400 font-normal">LIVE</span>
                )}
              </h3>
              <FrequencyVisualizer
                frequencyData={rawFrequencyData}
                isActive={isListening}
              />
              {acousticProfile && (
                <div className="mt-4">
                  <DbMeter
                    db={acousticProfile.overallDb}
                    optimalRange={profile?.optimalDbRange}
                  />
                </div>
              )}
              {acousticProfile && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="bg-gray-800/50 rounded-lg p-3">
                    <p className="text-xs text-gray-400">Dominant Frequency</p>
                    <p className="text-lg font-mono text-cyan-400">
                      {Math.round(acousticProfile.dominantFrequency)} Hz
                    </p>
                  </div>
                  <div className="bg-gray-800/50 rounded-lg p-3">
                    <p className="text-xs text-gray-400">Spectral Centroid</p>
                    <p className="text-lg font-mono text-purple-400">
                      {Math.round(acousticProfile.spectralCentroid)} Hz
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Productivity Tracker */}
            <ProductivityTracker
              snapshot={currentSnapshot}
              history={productivityHistory}
              screenPreview={screenPreview}
              isTracking={isTracking}
              onStartTracking={startTracking}
              onStopTracking={stopTracking}
              onSelfReport={submitSelfReport}
            />

            {/* Correlation Dashboard */}
            <CorrelationDashboard profile={profile} correlations={correlations} />
          </div>

          {/* Right Column - Controls & Social */}
          <div className="space-y-6">
            {/* Audio Overlay Control */}
            <AudioOverlayControl
              overlayState={overlayState}
              onStart={(type, vol, db) =>
                startOverlay(type as Parameters<typeof startOverlay>[0], vol, db)
              }
              onStop={stopOverlay}
              onSetVolume={setVolume}
              onSetSoundType={setSoundType}
              onGenerateAiBed={generateAiBed}
              currentMode={currentMode}
              recommendation={recommendation}
            />

            {/* Study Buddy Finder */}
            <StudyBuddyFinder userOptimalRange={profile?.optimalDbRange} />

            {/* On-Device Processing Badge */}
            <div className="bg-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-800 p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-green-400">On-Device Processing</p>
                  <p className="text-xs text-gray-400">
                    All audio analysis & screen capture processed locally.
                    No data leaves your device.
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="bg-gray-800/50 rounded p-2">
                  <span className="text-gray-400">Audio FFT</span>
                  <span className="block text-green-400 font-mono">On-device</span>
                </div>
                <div className="bg-gray-800/50 rounded p-2">
                  <span className="text-gray-400">Screen Diff</span>
                  <span className="block text-green-400 font-mono">On-device</span>
                </div>
                <div className="bg-gray-800/50 rounded p-2">
                  <span className="text-gray-400">Correlation</span>
                  <span className="block text-green-400 font-mono">On-device</span>
                </div>
                <div className="bg-gray-800/50 rounded p-2">
                  <span className="text-gray-400">Audio Gen</span>
                  <span className="block text-cyan-400 font-mono">Web Audio</span>
                </div>
              </div>
            </div>

            {/* Tech Stack */}
            <div className="bg-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-800 p-4">
              <p className="text-xs text-gray-400 mb-2">Powered by</p>
              <div className="flex flex-wrap gap-2">
                {['ZETIC Melange', 'ElevenLabs', 'Fetch.ai', 'MongoDB Atlas', 'Cognition', 'Web Audio API'].map(
                  (tech) => (
                    <span
                      key={tech}
                      className="px-2 py-1 bg-gray-800/50 text-gray-300 text-xs rounded-md border border-gray-700"
                    >
                      {tech}
                    </span>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
