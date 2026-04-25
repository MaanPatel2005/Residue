'use client';

import { useState, useEffect, useCallback } from 'react';

interface MyAgent {
  address: string;
  handle: string;
  port: number;
  name: string;
  role: string;
  agentId: number;
}

interface AgentActivity {
  timestamp: string;
  agent: string;
  action: string;
  detail: string;
}

interface AgentPanelProps {
  token: string | null;
}

export default function AgentPanel({ token }: AgentPanelProps) {
  const [myAgent, setMyAgent] = useState<MyAgent | null>(null);
  const [gatewayReady, setGatewayReady] = useState(false);
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [chatResult, setChatResult] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);

  // Fetch the logged-in user's assigned agent
  const fetchMyAgent = useCallback(async () => {
    if (!token) {
      setMyAgent(null);
      return;
    }
    try {
      const res = await fetch('/api/agents/my-agent', {
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMyAgent(data.agent);
      }
    } catch {
      // API not available
    }
  }, [token]);

  // Probe gateway liveness (for Test Agent Pipeline)
  const probeGateway = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/status');
      if (res.ok) {
        const data = await res.json();
        setGatewayReady(Boolean(data.agents?.gateway));
        if (data.activity) {
          setActivities((prev) => {
            const combined = [...data.activity, ...prev];
            return combined.slice(0, 20);
          });
        }
      }
    } catch {
      // API not available
    }
  }, []);

  useEffect(() => {
    fetchMyAgent();
    probeGateway();
    const interval = setInterval(() => {
      fetchMyAgent();
      probeGateway();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchMyAgent, probeGateway]);

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const openASIOneChat = () => {
    window.open('https://asi1.ai/chat', '_blank');
  };

  const testAgentChat = async () => {
    if (!gatewayReady) return;
    setChatLoading(true);
    setChatResult(null);
    try {
      const res = await fetch('/api/agents/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: `test-${Date.now()}`,
          user_id: 'user-1',
          goal_mode: 'focus',
          acoustic: {
            overall_db: 48,
            frequency_bands: [0.3, 0.5, 0.6, 0.4, 0.3, 0.2, 0.1],
            spectral_centroid: 1200,
            dominant_frequency: 400,
          },
        }),
      });
      const data = await res.json();
      const cogState = data.cognitive_state ?? data.perception?.cognitive_state ?? 'unknown';
      const reasoning = data.perception_reasoning ?? data.perception?.reasoning ?? '';
      const conf = data.confidence ?? data.perception?.confidence ?? 0;
      setChatResult(reasoning || cogState || 'Agent responded successfully');
      setActivities((prev) => [
        {
          timestamp: new Date().toISOString(),
          agent: 'Gateway',
          action: 'Orchestrate',
          detail: `State: ${cogState} (${Math.round(conf * 100)}% conf)`,
        },
        ...prev,
      ].slice(0, 20));
    } catch {
      setChatResult('Agent not reachable — make sure the Python agents are running');
    }
    setChatLoading(false);
  };

  const statusDot = (status?: string) => {
    if (status === 'online') return 'bg-green-400';
    if (status === 'checking') return 'bg-yellow-400 animate-pulse';
    return 'bg-gray-600';
  };

  return (
    <div className="bg-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-800 p-4 space-y-3">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex justify-between items-center w-full text-left"
      >
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-white">Agent Network</h3>
          <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-300 rounded">
            Fetch.ai
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="space-y-3">
          {/* Auth gate */}
          {!token ? (
            <div className="bg-gray-800/50 rounded-lg p-3">
              <p className="text-xs text-gray-400">
                Sign in to view your assigned Study Buddy agent.
              </p>
            </div>
          ) : myAgent ? (
            <div className="bg-gray-800/50 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${statusDot()}`} />
                <span className="text-sm font-medium text-white">{myAgent.name}</span>
                <span className="text-[9px] px-1 py-0.5 rounded text-green-400 bg-green-500/10">agent</span>
              </div>

              {/* Handle */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-purple-400 font-medium">{myAgent.handle}</span>
                <button
                  onClick={() => copyText(myAgent.handle, 'handle')}
                  className="p-0.5 rounded hover:bg-gray-700/50 transition-colors"
                  title="Copy handle"
                >
                  {copied === 'handle' ? (
                    <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Address */}
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-mono text-gray-500 flex-1">
                  {myAgent.address.length > 20
                    ? `${myAgent.address.slice(0, 12)}...${myAgent.address.slice(-8)}`
                    : myAgent.address}
                </p>
                <button
                  onClick={() => copyText(myAgent.address, 'address')}
                  className="p-1 rounded hover:bg-gray-700/50 transition-colors"
                  title="Copy agent address"
                >
                  {copied === 'address' ? (
                    <svg className="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-gray-800/50 rounded-lg p-3">
              <p className="text-xs text-gray-500">Loading your agent...</p>
            </div>
          )}

          {/* Chat with Agent Button */}
          <button
            onClick={openASIOneChat}
            className="w-full p-3 rounded-lg bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-blue-500/30 hover:border-blue-500/50 transition-all text-left"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white flex items-center gap-2">
                  Chat with Agent on ASI:One
                  <svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Talk to your Residue agent through Fetch.ai&apos;s ASI:One
                </p>
              </div>
            </div>
          </button>

          {/* Quick Test */}
          <div className="space-y-2">
            <button
              onClick={testAgentChat}
              disabled={chatLoading}
              className="w-full p-2 rounded-lg text-xs font-medium bg-gray-800/50 border border-gray-700 hover:border-gray-600 transition-all disabled:opacity-50 text-gray-300"
            >
              {chatLoading ? 'Querying agent...' : 'Test Agent Pipeline'}
            </button>
            {chatResult && (
              <div className="bg-gray-800/50 rounded-lg p-2 text-xs">
                <p className="text-gray-400 mb-1">Agent Response:</p>
                <p className="text-gray-300">{chatResult.slice(0, 200)}{chatResult.length > 200 ? '...' : ''}</p>
              </div>
            )}
          </div>

          {/* Activity Feed */}
          {activities.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-gray-400 font-medium">Recent Activity</p>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {activities.slice(0, 5).map((activity, i) => (
                  <div key={i} className="bg-gray-800/30 rounded p-1.5 text-xs flex items-start gap-2">
                    <span className="text-gray-600 font-mono shrink-0">
                      {new Date(activity.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                    <span className="text-purple-400 shrink-0">{activity.agent}</span>
                    <span className="text-gray-400 truncate">{activity.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
