'use client';

import { useCallback, useEffect, useState } from 'react';
import type { StudyBuddy } from '@/types';


interface BuddyConnection {
  buddyId: string;
  buddyName: string;
  buddyAgentAddresses: Record<string, string> | null;
  connectedAt: number;
}

type MatchingSource = 'uagents' | 'mongodb' | string;

const HELPER_ROLE_LABELS: Record<string, string> = {
  orchestrator: 'Session planner',
  perception: 'Focus reader',
  correlation: 'Study matchmaker',
  intervention: 'Sound tuner',
};

interface RawBuddyMatch {
  userId?: string;
  user_id?: string;
  candidate_id?: string;
  name?: string;
  candidate_name?: string;
  optimalDbRange?: [number, number];
  similarity?: number;
  compatibility_score?: number;
  currentlyStudying?: boolean;
  location?: string | { label?: string };
  candidate_profile?: {
    db_range?: [number, number] | null;
    optimal_db?: number | null;
    location?: string | null;
  };
}

interface Props {
  token?: string | null;
  userId?: string;
  eqVector?: number[];
}

function sourceLabel(source: MatchingSource | null) {
  if (source === 'uagents') {
    return 'Live helper network';
  }
  if (source === 'mongodb') {
    return 'Saved study profiles';
  }
  return source;
}

function helperRoleLabel(role: string) {
  return HELPER_ROLE_LABELS[role] ?? role;
}

function normalizeMatch(match: RawBuddyMatch, index: number): StudyBuddy {
  const id = match.userId ?? match.user_id ?? match.candidate_id ?? `match-${index}`;
  const profile = match.candidate_profile;
  const optimalDbRange = match.optimalDbRange
    ?? profile?.db_range
    ?? (profile?.optimal_db != null
      ? [Math.max(0, profile.optimal_db - 5), profile.optimal_db + 5] as [number, number]
      : [40, 60] as [number, number]);
  const location = typeof match.location === 'string'
    ? match.location
    : match.location?.label ?? profile?.location ?? undefined;

  return {
    id,
    name: match.name ?? match.candidate_name ?? `Study partner ${index + 1}`,
    optimalDbRange,
    similarity: match.similarity ?? match.compatibility_score ?? 0,
    currentlyStudying: Boolean(match.currentlyStudying),
    location,
  };
}

export default function StudyBuddyFinder({ token, userId, eqVector }: Props) {
  const [buddies, setBuddies] = useState<StudyBuddy[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set());
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [connectionMap, setConnectionMap] = useState<Map<string, BuddyConnection>>(new Map());
  const [matchSource, setMatchSource] = useState<MatchingSource | null>(null);

  // Load existing connections on mount
  useEffect(() => {
    if (!token) return;
    const loadConnections = async () => {
      try {
        const res = await fetch('/api/buddies/connections', {
          headers: { authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const ids = new Set<string>();
          const map = new Map<string, BuddyConnection>();
          for (const conn of data.connections as BuddyConnection[]) {
            ids.add(conn.buddyId);
            map.set(conn.buddyId, conn);
          }
          setConnectedIds(ids);
          setConnectionMap(map);
        }
      } catch {
        // API not available
      }
    };
    void loadConnections();
  }, [token]);

  const handleConnect = useCallback(async (buddy: StudyBuddy) => {
    if (!token) return;
    setConnectingId(buddy.id);
    try {
      const res = await fetch('/api/buddies/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          buddyId: buddy.id,
          buddyName: buddy.name,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const conn = data.connection as BuddyConnection;
        setConnectedIds((prev) => new Set(prev).add(buddy.id));
        setConnectionMap((prev) => {
          const next = new Map(prev);
          next.set(buddy.id, conn);
          return next;
        });
        setExpandedId(buddy.id);
      }
    } catch {
      // Connection failed
    }
    setConnectingId(null);
  }, [token]);

  const handleDisconnect = useCallback(async (buddyId: string) => {
    if (!token) return;
    try {
      const res = await fetch('/api/buddies/connect', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ buddyId }),
      });
      if (res.ok) {
        setConnectedIds((prev) => {
          const next = new Set(prev);
          next.delete(buddyId);
          return next;
        });
        setConnectionMap((prev) => {
          const next = new Map(prev);
          next.delete(buddyId);
          return next;
        });
        setExpandedId(null);
      }
    } catch {
      // Disconnect failed
    }
  }, [token]);

  const findBuddies = useCallback(async () => {
    if (!userId) return;
    setIsSearching(true);
    setMatchSource(null);
    try {
      const res = await fetch('/api/agents/matching', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          eqVector: eqVector?.length === 7 ? eqVector : [0, 0, 0, 0, 0, 0, 0],
          activeOnly: false,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setMatchSource(data.source ?? null);
        if (Array.isArray(data.matches)) {
          setBuddies(data.matches.map((match: RawBuddyMatch, index: number) => normalizeMatch(match, index)));
        } else {
          setBuddies([]);
        }
      } else {
        setBuddies([]);
        setMatchSource(null);
      }
    } catch {
      setBuddies([]);
      setMatchSource(null);
    } finally {
      setIsSearching(false);
    }
  }, [eqVector, userId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      findBuddies();
    }, 0);
    return () => clearTimeout(timer);
  }, [findBuddies]);

  return (
    <div className="bg-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-800 p-6 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-purple-300">Step 1</p>
          <h3 className="mt-1 text-xl font-semibold text-white">Find a Study Buddy</h3>
          <p className="mt-1 text-sm text-gray-400">
            Match with people who focus in similar sound environments.
          </p>
        </div>
        <button
          onClick={findBuddies}
          disabled={isSearching}
          className="self-start px-4 py-2 rounded-lg text-sm font-medium bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 transition-colors disabled:opacity-50"
        >
          {isSearching ? 'Finding...' : 'Refresh matches'}
        </button>
      </div>
      <details className="rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2 text-xs text-gray-400">
        <summary className="cursor-pointer text-gray-300 hover:text-white">
          How matches are found
        </summary>
        <div className="mt-2 space-y-2">
          <p>
            Your study matchmaker compares focus profile, noise level, and sound
            preferences. If live helpers are unavailable, saved study profiles keep
            matching available.
          </p>
          {matchSource && (
            <span className="inline-flex rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-[11px] text-purple-300">
              Used: {sourceLabel(matchSource)}
            </span>
          )}
        </div>
      </details>

      {isSearching ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-gray-800 bg-gray-950/30 py-10">
          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-400">Looking for compatible study buddies...</p>
        </div>
      ) : buddies.length === 0 ? (
        <div className="rounded-xl border border-gray-800 bg-gray-950/30 px-4 py-8 text-center">
          <p className="text-sm font-medium text-gray-300">No matches yet</p>
          <p className="mt-1 text-xs text-gray-500">
            Run a focus session first, then refresh to compare your sound profile.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {buddies.map((buddy) => {
            const isConnected = connectedIds.has(buddy.id);
            const isConnecting = connectingId === buddy.id;
            const isExpanded = expandedId === buddy.id;
            const connection = connectionMap.get(buddy.id);

            return (
              <div
                key={buddy.id}
                className="bg-gray-800/50 rounded-lg hover:bg-gray-800/80 transition-colors"
              >
                <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-linear-to-br from-purple-500 to-cyan-500 flex items-center justify-center text-white font-bold text-sm">
                      {buddy.name.charAt(0)}
                    </div>
                    {buddy.currentlyStudying && (
                      <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-gray-900" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white">{buddy.name}</p>
                      <span className="text-xs text-cyan-400">
                        {Math.round(buddy.similarity * 100)}% match
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 truncate">
                      {buddy.location ? `${buddy.location} · ` : ''}
                      Best around {Math.round(buddy.optimalDbRange[0])}-{Math.round(buddy.optimalDbRange[1])} dB
                    </p>
                  </div>
                  {isConnected ? (
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : buddy.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/15 text-blue-300 hover:bg-blue-500/25 transition-colors"
                    >
                      {isExpanded ? 'Hide helper' : 'Ask AI helper'}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleConnect(buddy)}
                      disabled={isConnecting || !token}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors disabled:opacity-50"
                    >
                      {isConnecting ? 'Connecting...' : 'Connect'}
                    </button>
                  )}
                </div>

                {/* Expanded connection details */}
                {isConnected && isExpanded && (
                  <div className="px-3 pb-3 space-y-2">
                    <div className="border-t border-gray-700/50 pt-3">
                      {connection?.buddyAgentAddresses ? (
                        <div className="space-y-3">
                          <p className="text-sm font-medium text-white">
                            Chat about this match
                          </p>
                          <p className="text-xs text-gray-400">
                            Copy the ID for the helper you want, then open ASI:One.
                          </p>
                          {Object.entries(connection.buddyAgentAddresses).map(([role, address]) => (
                            <div key={role} className="flex items-center gap-2 rounded-lg bg-gray-900/60 p-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium text-gray-200">{helperRoleLabel(role)}</p>
                                <p className="text-[10px] font-mono text-gray-500 truncate">{address}</p>
                              </div>
                              <button
                                onClick={() => navigator.clipboard.writeText(address)}
                                className="rounded-md bg-purple-500/10 px-2 py-1 text-[11px] font-medium text-purple-300 hover:bg-purple-500/20 transition-colors"
                                title="Copy Agent ID"
                              >
                                Copy ID
                              </button>
                            </div>
                          ))}
                          <a
                            href="https://asi1.ai/chat"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 flex items-center justify-center gap-1.5 w-full p-2 rounded-lg text-xs font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 transition-colors"
                          >
                            Open ASI:One chat
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-500">
                          Helper chat is not available for this buddy yet.
                        </p>
                      )}
                      <button
                        onClick={() => handleDisconnect(buddy.id)}
                        className="mt-2 w-full p-1.5 rounded-lg text-[10px] font-medium text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
