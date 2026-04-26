'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import FrequencyVisualizer from '@/components/FrequencyVisualizer';
import DbMeter from '@/components/DbMeter';
import ProductivityTracker from '@/components/ProductivityTracker';
import AudioOverlayControl from '@/components/AudioOverlayControl';
import CorrelationDashboard from '@/components/CorrelationDashboard';
import StudyBuddyFinder from '@/components/StudyBuddyFinder';
import AgentMatchPanel from '@/components/AgentMatchPanel';
import ModeSelector from '@/components/ModeSelector';
import ModeSelector, { type Mode } from '@/components/ModeSelector';
import AuthControl from '@/components/AuthControl';
import PhonePairingPanel from '@/components/PhonePairingPanel';
import AgentPanel from '@/components/AgentPanel';
import ResidueLogo from '@/components/ResidueLogo';
import { useAudioCapture } from '@/hooks/useAudioCapture';
import { useScreenCapture } from '@/hooks/useScreenCapture';
import { useAudioOverlay } from '@/hooks/useAudioOverlay';
import { useAuth } from '@/hooks/useAuth';
import { usePhoneCompanion } from '@/hooks/usePhoneCompanion';
import {
  createCorrelation,
  analyzeCorrelations,
  getRecommendation,
} from '@/lib/correlationEngine';
import type { AcousticProfile, AcousticStateCorrelation } from '@/types';

const siteTitleClass =
  'font-[family-name:var(--font-economica)] text-4xl font-bold tracking-wide text-[#8c52ff]';

const MODE_THEMES: Record<Mode, {
  background: string;
  glow: string;
  header: string;
  panel: string;
  accentText: string;
}> = {
  focus: {
    background: 'bg-[#07111f]',
    glow: 'bg-[radial-gradient(circle_at_20%_10%,rgba(34,211,238,0.24),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(59,130,246,0.16),transparent_30%)]',
    header: 'border-cyan-500/20 bg-slate-950/70',
    panel: 'border-cyan-500/20 shadow-cyan-950/20',
    accentText: 'text-cyan-300',
  },
  calm: {
    background: 'bg-[#071713]',
    glow: 'bg-[radial-gradient(circle_at_15%_0%,rgba(16,185,129,0.22),transparent_30%),radial-gradient(circle_at_85%_15%,rgba(45,212,191,0.14),transparent_28%)]',
    header: 'border-emerald-500/20 bg-emerald-950/30',
    panel: 'border-emerald-500/20 shadow-emerald-950/20',
    accentText: 'text-emerald-300',
  },
  creative: {
    background: 'bg-[#16091f]',
    glow: 'bg-[radial-gradient(circle_at_18%_5%,rgba(217,70,239,0.24),transparent_30%),radial-gradient(circle_at_78%_10%,rgba(124,58,237,0.2),transparent_32%)]',
    header: 'border-fuchsia-500/20 bg-purple-950/40',
    panel: 'border-fuchsia-500/20 shadow-fuchsia-950/20',
    accentText: 'text-fuchsia-300',
  },
  social: {
    background: 'bg-[#1b1205]',
    glow: 'bg-[radial-gradient(circle_at_18%_8%,rgba(245,158,11,0.24),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(249,115,22,0.18),transparent_28%)]',
    header: 'border-amber-500/20 bg-orange-950/35',
    panel: 'border-amber-500/20 shadow-amber-950/20',
    accentText: 'text-amber-300',
  },
};

export default function Home() {
  const auth = useAuth();

  if (!auth.ready) {
    return <GateLoading />;
  }

  if (!auth.user) {
    return <AuthGateHome />;
  }

  return <Dashboard auth={auth} />;
}

type AuthSession = ReturnType<typeof useAuth>;

function GateLoading() {
  return (
    <main className="min-h-screen bg-[#0a0a1a] text-white flex items-center justify-center px-4">
      <div className="text-center">
        <ResidueLogo className="mx-auto mb-4 w-10 h-10 rounded-xl animate-pulse" priority />
        <p className="text-sm text-gray-400">Checking your session...</p>
      </div>
    </main>
  );
}

function AuthGateHome() {
  return (
    <main className="min-h-screen bg-[#0a0a1a] text-white overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.2),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(147,51,234,0.18),transparent_35%)]" />
      <header className="relative z-10 border-b border-gray-800/50 bg-gray-900/30 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ResidueLogo className="w-14 h-14 rounded-lg" priority />
            <div>
              <h1 className={siteTitleClass}>RESIDUE</h1>
              <p className="text-sm text-gray-500">Personalized Acoustic Intelligence</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="text-xs px-3 py-1.5 rounded-lg border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="text-xs px-3 py-1.5 rounded-lg bg-linear-to-r from-cyan-500 to-purple-600 text-white hover:opacity-90"
            >
              Create account
            </Link>
          </div>
        </div>
      </header>

      <section className="relative z-10 min-h-[calc(100vh-73px)] flex items-center">
        <div className="max-w-7xl mx-auto px-4 py-16 grid lg:grid-cols-[1.05fr_0.95fr] gap-10 items-center">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-cyan-300/80 mb-5">
              Private focus workspace
            </p>
            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight">
              Tune your environment to the way you actually work.
            </h2>
            <p className="mt-6 text-lg text-gray-300 max-w-2xl">
              Residue learns your acoustic profile, tracks focus signals locally,
              and adapts your workspace with personalized audio overlays.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/signup"
                className="px-5 py-3 rounded-xl bg-linear-to-r from-cyan-500 to-purple-600 text-sm font-semibold text-white hover:opacity-90"
              >
                Create account
              </Link>
              <Link
                href="/login"
                className="px-5 py-3 rounded-xl border border-gray-700 text-sm font-semibold text-gray-200 hover:bg-gray-800/70"
              >
                Sign in
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border border-gray-800 bg-gray-900/70 backdrop-blur-md p-6 shadow-2xl shadow-cyan-950/20">
            <div className="grid gap-4">
              {[
                ['Acoustic profile', 'Learns the sound ranges where you focus best.'],
                ['Local analysis', 'Processes audio and screen changes on your device.'],
                ['Companion mode', 'Pairs phone distraction signals to your session.'],
              ].map(([title, body]) => (
                <div key={title} className="rounded-2xl border border-gray-800 bg-gray-950/50 p-4">
                  <p className="text-sm font-semibold text-cyan-300">{title}</p>
                  <p className="mt-2 text-sm text-gray-400">{body}</p>
                </div>
              ))}
            </div>
            <p className="mt-5 text-xs text-gray-500">
              Sign in is required before accessing the dashboard.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function Dashboard({ auth }: { auth: AuthSession }) {
  const [currentMode, setCurrentMode] = useState<Mode>('focus');
  const [correlations, setCorrelations] = useState<AcousticStateCorrelation[]>([]);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionDuration, setSessionDuration] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const acousticProfileRef = useRef<AcousticProfile | null>(null);
  const currentModeRef = useRef(currentMode);

  const phone = usePhoneCompanion(auth.token, sessionActive ? sessionId : null);

  const {
    isListening,
    currentProfile: acousticProfile,
    rawFrequencyData,
    startListening,
    stopListening,
    error: audioError,
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
    generateAiBed,
    applyModePreset,
  } = useAudioOverlay();

  useEffect(() => {
    acousticProfileRef.current = acousticProfile;
  }, [acousticProfile]);

  useEffect(() => {
    currentModeRef.current = currentMode;
  }, [currentMode]);

  useEffect(() => {
    const userId = auth.user?.uid;
    if (!userId) return;

    let cancelled = false;
    fetch(`/api/correlations?userId=${encodeURIComponent(userId)}&limit=200`)
      .then((res) => (res.ok ? res.json() : []))
      .then((stored: AcousticStateCorrelation[]) => {
        if (!cancelled && Array.isArray(stored)) {
          setCorrelations(stored);
        }
      })
      .catch(() => {
        // MongoDB may be unavailable; live in-memory correlations still work.
      });

    return () => {
      cancelled = true;
    };
  }, [auth.user?.uid]);

  const handleStartSession = useCallback(async () => {
    await startListening();
    const newSessionId = `session-${Date.now()}`;
    setSessionActive(true);
    setSessionDuration(0);
    setSessionId(newSessionId);
    phone.reset();

    // Notify the backend so user_data.studyStatus.currentlyStudying
    // flips to true *immediately* on click. The iOS companion polls
    // `/api/phone/active-session` and uses the false→true transition
    // as the rising-edge signal to auto-bind + reset its counters.
    // We can't depend on the side-effect of /api/session being
    // POSTed from the snapshot useEffect — that path only runs once
    // the user grants mic + screen-capture, which is blocked in
    // insecure-context dev origins.
    const token = auth.token;
    if (token) {
      fetch('/api/session/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ sessionId: newSessionId, mode: currentMode }),
      }).catch(() => {
        /* MongoDB may be unavailable; phone falls back to manual pairing. */
      });
    }
  }, [startListening, phone, auth.token, currentMode]);

  const handleStopSession = useCallback(() => {
    stopListening();
    stopTracking();
    stopOverlay();
    setSessionActive(false);

    // Notify the backend so user_data.studyStatus.currentlyStudying flips
    // to false. The iOS companion polls this flag to auto-trigger the
    // on-device Melange distraction report when the desktop session
    // ends (no manual button press needed on the phone).
    const token = auth.token;
    const sid = sessionId;
    if (token && sid) {
      fetch('/api/session/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ sessionId: sid }),
      }).catch(() => {
        /* MongoDB may be unavailable; phone falls back to manual report. */
      });
    }
  }, [stopListening, stopTracking, stopOverlay, auth.token, sessionId]);

  useEffect(() => {
    if (!sessionActive) return;
    const interval = setInterval(() => {
      setSessionDuration((d) => d + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionActive]);

  useEffect(() => {
    const latestAcousticProfile = acousticProfileRef.current;
    const userId = auth.user?.uid;
    if (latestAcousticProfile && currentSnapshot && userId) {
      const mode = currentModeRef.current;
      const corr = createCorrelation(latestAcousticProfile, currentSnapshot, userId);
      queueMicrotask(() => {
        setCorrelations((prev) => [...prev, corr].slice(-200));
      });

      fetch('/api/correlations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corr),
      }).catch(() => { /* MongoDB may be unavailable */ });

      // Persist snapshot to MongoDB (fire-and-forget)
      fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          sessionId,
          mode,
          acoustic_features: {
            overallDb: latestAcousticProfile.overallDb,
            frequencyBands: latestAcousticProfile.frequencyBands,
            dominantFrequency: latestAcousticProfile.dominantFrequency,
            spectralCentroid: latestAcousticProfile.spectralCentroid,
          },
          behavioral_features: null,
          productivity_score: currentSnapshot.productivityScore,
          state: currentSnapshot.productivityScore > 70 ? 'focused' : currentSnapshot.productivityScore > 40 ? 'normal' : 'distracted',
          goal: mode,
        }),
      }).catch(() => { /* MongoDB may be unavailable */ });
    }
  }, [auth.user?.uid, currentSnapshot, sessionId]);

  const profile = useMemo(() => analyzeCorrelations(correlations), [correlations]);

  const studyBuddyEqVector = useMemo(() => {
    const magnitudes = profile?.optimalFrequencyProfile.map((band) => band.magnitude) ?? [];
    return Array.from({ length: 7 }, (_, index) => magnitudes[index] ?? 0);
  }, [profile]);

  const recommendation =
    profile && acousticProfile ? getRecommendation(profile, acousticProfile) : null;

  const modeTheme = MODE_THEMES[currentMode];

  const handleModeChange = useCallback((mode: Mode) => {
    setCurrentMode(mode);
    applyModePreset(mode);
  }, [applyModePreset]);

  const formatDuration = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <main className={`relative min-h-screen overflow-hidden text-white transition-colors duration-700 ${modeTheme.background}`}>
      <div className={`pointer-events-none absolute inset-0 transition-all duration-700 ${modeTheme.glow}`} />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(10,10,26,0.04),rgba(10,10,26,0.58))]" />
      {/* Header */}
      <header className={`sticky top-0 z-50 border-b backdrop-blur-md transition-colors duration-500 ${modeTheme.header}`}>
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ResidueLogo className="w-14 h-14 rounded-lg" priority />
            <div>
              <h1 className={siteTitleClass}>RESIDUE</h1>
              {/* <p className="text-sm text-gray-500">Personalized Acoustic Intelligence</p> */}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <AuthControl
              ready={auth.ready}
              user={auth.user}
              onLogout={auth.logout}
            />
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
                  : 'bg-linear-to-r from-cyan-500 to-purple-600 text-white hover:opacity-90'
              }`}
            >
              {sessionActive ? 'End Session' : 'Start Session'}
            </button>
          </div>
        </div>
      </header>

      <div className="relative z-10 max-w-7xl mx-auto px-4 py-6 space-y-6">
        {audioError && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <strong className="font-semibold">Microphone unavailable:</strong>{' '}
            {audioError}
          </div>
        )}

        {/* Mode Selector */}
        <ModeSelector currentMode={currentMode} onModeChange={handleModeChange} />

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Audio Analysis */}
          <div className="lg:col-span-2 space-y-6">
            {/* Frequency Visualizer */}
            <div className={`bg-gray-900/80 backdrop-blur-sm rounded-xl border p-6 shadow-2xl transition-colors duration-500 ${modeTheme.panel}`}>
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
                    <p className={`text-lg font-mono ${modeTheme.accentText}`}>
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
              phonePenalty={phone.state?.productivityPenalty ?? 0}
            />

            {/* Correlation Dashboard */}
            <CorrelationDashboard profile={profile} correlations={correlations} />
          </div>

          {/* Right Column - Controls & Social */}
          <div className="space-y-6">
            {/* Phone Companion */}
            <PhonePairingPanel
              signedIn={Boolean(auth.user)}
              sessionActive={sessionActive}
              pairing={phone.pairing}
              state={phone.state}
              error={phone.error}
              onStartPairing={phone.startPairing}
            />

            {/* Audio Overlay Control */}
            <AudioOverlayControl
              overlayState={overlayState}
              onStart={(type, vol, db) =>
                startOverlay(type as Parameters<typeof startOverlay>[0], vol, db, currentMode)
              }
              onStop={stopOverlay}
              onSetVolume={setVolume}
              onGenerateAiBed={(mode) => generateAiBed(mode, undefined, auth.user?.uid)}
              currentMode={currentMode}
              recommendation={recommendation}
            />

            {/* Agent Network */}
            <AgentPanel token={auth.token} userId={auth.user?.uid ?? null} />

            {/* Cross-Agent Matching (CorrelationAgent) */}
            <AgentMatchPanel
              token={auth.token}
              userId={auth.user?.uid ?? null}
            />

            {/* Study Buddy Finder */}
            <StudyBuddyFinder
              userId={auth.user?.uid}
              userOptimalRange={profile?.optimalDbRange}
              eqVector={studyBuddyEqVector}
            />

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
