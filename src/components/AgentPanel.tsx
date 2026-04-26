'use client';

import { useState, useEffect, useCallback } from 'react';

type AgentKey = 'orchestrator' | 'perception' | 'correlation' | 'intervention';

interface AgentEntry {
  address: string;
  port: number;
  name: string;
  role: string;
}

interface AgentPanelProps {
  token: string | null;
  userId: string | null;
}

const ASI_ONE_URL = 'https://asi1.ai/chat';

const HELPER_ACTIONS: Array<{
  key: AgentKey;
  title: string;
  description: string;
}> = [
  {
    key: 'orchestrator',
    title: 'Plan my study session',
    description: 'Ask for help setting up a focused study plan.',
  },
  {
    key: 'perception',
    title: 'Understand my focus',
    description: 'Ask what your sound patterns may say about focus.',
  },
  {
    key: 'correlation',
    title: 'Find study partners',
    description: 'Ask why certain study buddies may be a good match.',
  },
  {
    key: 'intervention',
    title: 'Tune my sound',
    description: 'Ask what ambient sound might help right now.',
  },
];

export default function AgentPanel({ token }: AgentPanelProps) {
  const [allAgents, setAllAgents] = useState<Partial<Record<AgentKey, AgentEntry>> | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const fetchMyAgent = useCallback(async () => {
    if (!token) {
      setAllAgents(null);
      return;
    }
    try {
      const res = await fetch('/api/agents/my-agent', {
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.agents) setAllAgents(data.agents);
      }
    } catch {
      // API not available
    }
  }, [token]);

  useEffect(() => {
    const refresh = () => {
      void fetchMyAgent();
    };
    const timeout = window.setTimeout(refresh, 0);
    const interval = window.setInterval(refresh, 30000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [fetchMyAgent]);

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const openASIOneChat = () => {
    window.open(ASI_ONE_URL, '_blank');
  };

  return (
    <div className="bg-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-800 p-5 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-[0.22em] text-blue-300">Step 2</p>
        <h3 className="mt-1 text-xl font-semibold text-white">Chat With Your AI Helper</h3>
        <p className="mt-1 text-sm text-gray-400">
          Choose what you need. Copy the Agent ID, then open ASI:One.
        </p>
      </div>

      {!token ? (
        <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-4">
          <p className="text-sm font-medium text-white">Sign in to get your helper IDs.</p>
          <p className="mt-1 text-xs text-gray-500">
            ASI:One uses an Agent ID to know which helper you want to chat with.
          </p>
        </div>
      ) : allAgents ? (
        <div className="space-y-3">
          {HELPER_ACTIONS.map((action) => {
            const agent = allAgents[action.key];
            const copyKey = `helper-${action.key}`;
            return (
              <div key={action.key} className="rounded-xl border border-gray-800 bg-gray-950/40 p-3">
                <p className="text-sm font-medium text-white">{action.title}</p>
                <p className="mt-1 text-xs text-gray-400">{action.description}</p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <button
                    onClick={() => agent && copyText(agent.address, copyKey)}
                    disabled={!agent}
                    className="rounded-lg bg-blue-500/15 px-3 py-2 text-xs font-medium text-blue-300 hover:bg-blue-500/25 transition-colors disabled:opacity-50"
                  >
                    {copied === copyKey ? 'Copied ID' : 'Copy Agent ID'}
                  </button>
                  <button
                    onClick={openASIOneChat}
                    className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-medium text-gray-300 hover:border-blue-500/40 hover:text-blue-300 transition-colors"
                  >
                    Open ASI:One
                  </button>
                </div>
              </div>
            );
          })}

          <details className="rounded-xl border border-gray-800 bg-black/20 px-3 py-2 text-xs text-gray-500">
            <summary className="cursor-pointer text-gray-400 hover:text-white">
              Advanced: helper IDs
            </summary>
            <div className="mt-2 space-y-2">
              {HELPER_ACTIONS.map((action) => {
                const agent = allAgents[action.key];
                if (!agent) return null;
                const copyKey = `advanced-helper-${action.key}`;
                return (
                  <div key={action.key} className="rounded-lg border border-gray-800/80 bg-gray-950/50 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-gray-300">{action.title}</p>
                      <button
                        type="button"
                        onClick={() => copyText(agent.address, copyKey)}
                        className="shrink-0 rounded-md border border-gray-700 px-2 py-1 text-[10px] font-medium text-gray-300 transition-colors hover:border-blue-500/40 hover:text-blue-300"
                      >
                        {copied === copyKey ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <p className="mt-1 truncate font-mono" title={agent.address}>
                      {agent.address}
                    </p>
                  </div>
                );
              })}
            </div>
          </details>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-4">
          <p className="text-sm text-gray-400">Loading your helper IDs...</p>
        </div>
      )}
    </div>
  );
}
