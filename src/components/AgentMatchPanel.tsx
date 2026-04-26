'use client';

import { useCallback, useRef, useState } from 'react';

import type {
  CrossAgentMatch,
  CrossMatchResponse,
} from '@/app/api/agents/cross-match/route';

interface AgentMatchPanelProps {
  token: string | null;
  userId: string | null;
}

interface ActivityEntry {
  // Stable, per-entry id so React doesn't reuse DOM nodes when entries are
  // prepended. Multiple appends in the same tick share a timestamp, so we use
  // a monotonically increasing counter.
  id: number;
  timestamp: string;
  channel: 'client' | 'correlation' | 'profile-exchange' | 'asi1' | 'system';
  message: string;
}

const AGENTVERSE_BASE = 'https://agentverse.ai/agents/details';

/**
 * AgentMatchPanel — surfaces the cross-agent CorrelationAgent matching flow.
 *
 * Calls /api/agents/cross-match (which proxies to the Python orchestrator's
 * /match endpoint) and renders:
 *   - the full compatibility breakdown (EQ / dB / sound) as bars
 *   - the ASI1-Mini reasoning paragraph for each candidate
 *   - the matched user's agent_address with a link to Agentverse
 *   - a live activity feed of the cross-agent message round-trip
 */
export default function AgentMatchPanel({ token, userId }: AgentMatchPanelProps) {
  const [matches, setMatches] = useState<CrossAgentMatch[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [agentAddresses, setAgentAddresses] = useState<{
    orchestrator?: string;
    correlation?: string;
  } | null>(null);
  const activityIdRef = useRef(0);

  const appendActivity = useCallback(
    (channel: ActivityEntry['channel'], message: string) => {
      const id = activityIdRef.current++;
      setActivity((prev) =>
        [
          { id, timestamp: new Date().toISOString(), channel, message },
          ...prev,
        ].slice(0, 30),
      );
    },
    [],
  );

  const findMatches = useCallback(async () => {
    if (!token || !userId) {
      setError('Sign in to find compatible study partners.');
      return;
    }

    setLoading(true);
    setError(null);
    setMatches([]);
    setActivity([]);

    appendActivity('client', `→ Sending FindMatchesRequest(user=${userId}, top_k=5) to orchestrator`);

    try {
      const res = await fetch('/api/agents/cross-match', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ top_k: 5 }),
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string;
          hint?: string;
          detail?: string;
        };
        const hint = errBody.hint || errBody.detail || 'unknown error';
        setError(errBody.error === 'orchestrator_unreachable'
          ? `Python agent mesh not reachable. ${hint}`
          : `Match request failed: ${hint}`);
        appendActivity('system', `✗ ${errBody.error || 'request failed'}`);
        return;
      }

      const data = (await res.json()) as CrossMatchResponse;
      setSource(data.source);
      setAgentAddresses(data.agent_addresses ?? null);

      appendActivity(
        'correlation',
        `← CorrelationAgent ran vector_search, returned ${data.matches.length} candidates (source=${data.source})`,
      );

      // Synthesize per-match cross-agent message activity for the feed.
      data.matches.forEach((m, i) => {
        if (m.agent_address) {
          appendActivity(
            'profile-exchange',
            `→ ProfileExchangeRequest from your agent → ${m.agent_address.slice(0, 20)}…`,
          );
          appendActivity(
            'profile-exchange',
            `← ProfileExchangeResponse: compatibility=${Math.round(
              m.compatibility_score * 100,
            )}% (rank #${i + 1})`,
          );
        }
        if (m.reasoning && m.reasoning.length > 60) {
          appendActivity('asi1', `ASI1-Mini reasoning generated (${m.reasoning.length} chars) for ${m.user_id.slice(0, 12)}…`);
        }
      });

      setMatches(data.matches);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      setError(`Network error: ${msg}`);
      appendActivity('system', `✗ ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [appendActivity, token, userId]);

  return (
    <div className="bg-gray-900/80 backdrop-blur-sm rounded-xl border border-purple-900/50 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-[0.25em] text-purple-300">
              Cross-Agent Matching
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
              Fetch.ai uAgents
            </span>
          </div>
          <h3 className="mt-1 text-lg font-semibold text-white">
            Acoustic compatibility, agent-to-agent
          </h3>
          <p className="text-xs text-gray-400">
            Your CorrelationAgent talks to other users&apos; agents over Fetch.ai uAgents,
            exchanges acoustic profiles, and computes compatibility with ASI1-Mini reasoning.
          </p>
        </div>
        <button
          onClick={findMatches}
          disabled={loading || !token}
          className="shrink-0 px-3.5 py-2 rounded-lg text-xs font-medium bg-linear-to-r from-purple-500 to-cyan-500 text-white hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? 'Matching…' : 'Find study partners'}
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {(source || agentAddresses?.correlation) && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
          {source && (
            <span
              className={`px-2 py-0.5 rounded-full border ${
                source === 'agent'
                  ? 'bg-green-500/10 text-green-300 border-green-500/30'
                  : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
              }`}
            >
              source: {source === 'agent' ? 'live agent mesh' : 'sync fallback'}
            </span>
          )}
          {agentAddresses?.correlation && agentAddresses.correlation !== 'local' && (
            <a
              href={`${AGENTVERSE_BASE}/${agentAddresses.correlation}`}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-0.5 rounded-full bg-gray-800/70 border border-gray-700 hover:border-cyan-500/40 hover:text-cyan-300 transition font-mono"
              title="View CorrelationAgent on Agentverse"
            >
              corr: {agentAddresses.correlation.slice(0, 14)}…
            </a>
          )}
        </div>
      )}

      {matches.length > 0 && (
        <div className="space-y-3">
          {matches.map((m, idx) => (
            <MatchCard key={`${m.user_id}-${idx}`} match={m} rank={idx + 1} />
          ))}
        </div>
      )}

      {activity.length > 0 && (
        <details className="text-xs" open>
          <summary className="cursor-pointer text-gray-300 hover:text-white">
            Agent message log ({activity.length})
          </summary>
          <div className="mt-2 space-y-1 max-h-56 overflow-y-auto bg-black/40 rounded-lg p-3 font-mono">
            {activity.map((entry) => (
              <div
                key={entry.id}
                className={`leading-relaxed ${
                  entry.channel === 'profile-exchange'
                    ? 'text-purple-300'
                    : entry.channel === 'correlation'
                      ? 'text-cyan-300'
                      : entry.channel === 'asi1'
                        ? 'text-green-300'
                        : entry.channel === 'client'
                          ? 'text-gray-300'
                          : 'text-red-300'
                }`}
              >
                <span className="text-gray-600">
                  [{entry.timestamp.split('T')[1].slice(0, 12)}]
                </span>{' '}
                <span className="text-gray-500">{entry.channel}:</span>{' '}
                {entry.message}
              </div>
            ))}
          </div>
        </details>
      )}

      {matches.length === 0 && !loading && !error && (
        <p className="text-xs text-gray-500">
          Click &quot;Find study partners&quot; to query your CorrelationAgent.
          You&apos;ll need an acoustic profile (run a session first).
        </p>
      )}
    </div>
  );
}

interface MatchCardProps {
  match: CrossAgentMatch;
  rank: number;
}

function MatchCard({ match, rank }: MatchCardProps) {
  const compatPct = Math.round(match.compatibility_score * 100);
  const eqPct = Math.round(match.eq_similarity * 100);
  const dbPct = Math.round(match.db_overlap * 100);
  const soundPct = Math.round(match.sound_overlap * 100);

  const profile = match.candidate_profile;
  const dbRange = profile?.db_range
    ? `${Math.round(profile.db_range[0])}–${Math.round(profile.db_range[1])} dB`
    : profile?.optimal_db != null
      ? `~${Math.round(profile.optimal_db)} dB`
      : null;
  const location = profile?.location;

  return (
    <div className="rounded-lg bg-gray-800/50 border border-gray-700/60 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0 w-10 h-10 rounded-full bg-linear-to-br from-purple-500 to-cyan-500 flex items-center justify-center text-white font-semibold text-sm">
            #{rank}
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <p className="text-sm font-semibold text-white truncate">
                {match.user_id}
              </p>
              <span className="text-xs font-mono text-cyan-300">
                {compatPct}% compatible
              </span>
            </div>
            {location && (
              <p className="text-xs text-gray-400 truncate">{location}</p>
            )}
          </div>
        </div>
        {match.agent_address && (
          <a
            href={`${AGENTVERSE_BASE}/${match.agent_address}`}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-[10px] font-mono px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-gray-400 hover:border-purple-500/40 hover:text-purple-300 transition"
            title="View this user's agent on Agentverse"
          >
            {match.agent_address.slice(0, 14)}…
          </a>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Bar label="EQ similarity" pct={eqPct} accent="cyan" />
        <Bar label="dB overlap" pct={dbPct} accent="purple" />
        <Bar label="sound prefs" pct={soundPct} accent="emerald" />
      </div>

      {(match.shared_sounds.length > 0 || match.shared_bands.length > 0 || dbRange) && (
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {dbRange && (
            <span className="px-2 py-0.5 rounded-full bg-gray-900/60 border border-gray-700 text-gray-300">
              {dbRange}
            </span>
          )}
          {match.shared_sounds.map((s) => (
            <span
              key={`s-${s}`}
              className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
            >
              ♬ {s}
            </span>
          ))}
          {match.shared_bands.map((b) => (
            <span
              key={`b-${b}`}
              className="px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300"
            >
              {b}
            </span>
          ))}
        </div>
      )}

      {match.reasoning && (
        <p className="text-xs leading-relaxed text-gray-300 bg-gray-900/40 rounded-md p-3 border-l-2 border-purple-500/40">
          <span className="text-purple-300 font-medium">ASI1-Mini · </span>
          {match.reasoning}
        </p>
      )}
    </div>
  );
}

interface BarProps {
  label: string;
  pct: number;
  accent: 'cyan' | 'purple' | 'emerald';
}

function Bar({ label, pct, accent }: BarProps) {
  const fill = {
    cyan: 'bg-cyan-400',
    purple: 'bg-purple-400',
    emerald: 'bg-emerald-400',
  }[accent];
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-[10px] uppercase tracking-wider text-gray-500">
        <span>{label}</span>
        <span className="font-mono text-gray-300">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-700/60 overflow-hidden">
        <div
          className={`h-full ${fill} transition-all`}
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
    </div>
  );
}
