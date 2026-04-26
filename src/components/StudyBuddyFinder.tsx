'use client';

import { useCallback, useEffect, useState } from 'react';
import type { StudyBuddy } from '@/types';


interface BuddyConnection {
  buddyId: string;
  buddyName: string;
  buddyAgentAddresses: Record<string, string> | null;
  connectedAt: number;
}

interface Props {
  token?: string | null;
  userId?: string;
  userOptimalRange?: [number, number];
  eqVector?: number[];
}

export default function StudyBuddyFinder({ token, userId, userOptimalRange, eqVector }: Props) {
  const [buddies, setBuddies] = useState<StudyBuddy[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set());
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [connectionMap, setConnectionMap] = useState<Map<string, BuddyConnection>>(new Map());

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
        if (Array.isArray(data.matches)) {
          setBuddies(data.matches.map((match: {
            userId: string;
            name: string;
            optimalDbRange: [number, number];
            similarity: number;
            currentlyStudying: boolean;
            location?: string;
          }) => ({
            id: match.userId,
            name: match.name,
            optimalDbRange: match.optimalDbRange,
            similarity: match.similarity,
            currentlyStudying: match.currentlyStudying,
            location: match.location,
          })));
        } else {
          setBuddies([]);
        }
      } else {
        setBuddies([]);
      }
    } catch {
      setBuddies([]);
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
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-white">Study Buddy Finder</h3>
        <button
          onClick={findBuddies}
          disabled={isSearching}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors disabled:opacity-50"
        >
          {isSearching ? 'Searching...' : 'Refresh'}
        </button>
      </div>
      <p className="text-xs text-gray-400">
        Find people nearby who study best in similar acoustic environments
        <span className="ml-1 text-purple-400">(Powered by Fetch.ai Agents)</span>
      </p>

      {isSearching ? (
        <div className="flex items-center justify-center py-8">
          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : buddies.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <p className="text-sm text-gray-500">No study buddies found. Check back later!</p>
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
                <div className="flex items-center gap-3 p-3">
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
                      {buddy.location} &middot; Optimal: {buddy.optimalDbRange[0]}-{buddy.optimalDbRange[1]}dB
                    </p>
                  </div>
                  {isConnected ? (
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : buddy.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors flex items-center gap-1"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Connected
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
                    <div className="border-t border-gray-700/50 pt-2">
                      {connection?.buddyAgentAddresses ? (
                        <div className="space-y-1.5">
                          <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                            Agent Addresses — chat on ASI:One
                          </p>
                          {Object.entries(connection.buddyAgentAddresses).map(([role, address]) => (
                            <div key={role} className="flex items-center gap-2">
                              <span className="text-[9px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-400 min-w-[72px] text-center">
                                {role}
                              </span>
                              <span className="text-[10px] font-mono text-gray-500 flex-1 truncate">
                                {address}
                              </span>
                              <button
                                onClick={() => navigator.clipboard.writeText(address)}
                                className="p-0.5 rounded hover:bg-gray-700/50 transition-colors"
                                title="Copy address"
                              >
                                <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              </button>
                            </div>
                          ))}
                          <a
                            href="https://asi1.ai/chat"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 flex items-center justify-center gap-1.5 w-full p-2 rounded-lg text-xs font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 transition-colors"
                          >
                            Chat on ASI:One
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-500">
                          No agent addresses available for this user yet.
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
