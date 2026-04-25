import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';

interface AgentInfo {
  address: string;
  port: number;
  name: string;
  role: string;
  chat_url?: string;
  status: 'online' | 'offline';
}

interface AgentMap {
  gateway: AgentInfo;
  buddy_user: AgentInfo;
  buddy_peer: AgentInfo;
}

/**
 * GET /api/agents/status
 *
 * Returns the addresses and status of all agents in the mesh.
 * Reads from agent-addresses.json (written by run_agent_mesh.py)
 * and probes the Python orchestrator for liveness.
 */
export async function GET() {
  const makeDefault = (
    address: string,
    port: number,
    name: string,
    role: string,
    chat_url?: string,
  ): AgentInfo => ({
    address,
    port,
    name,
    role,
    chat_url,
    status: 'offline',
  });

  // Default agent addresses (from seeds — deterministic)
  let agents: AgentMap = {
    gateway: makeDefault(
      'agent1qvuwcewf5lj7p5vpnfdev3ja80f7wmdmwg3sj7y2dqk335cgfjc2vhf4af8',
      8780,
      'Residue Gateway',
      'gateway',
      'https://asi1.ai/chat',
    ),
    buddy_user: makeDefault(
      'agent1qtgdgv6nj6zd7hkpv4rwrzs8aqem6cyvxqcxvxgsrwfe5qdz96ulyp77sc6',
      8781,
      'Your Study Buddy',
      'user',
    ),
    buddy_peer: makeDefault(
      'agent1qgacmc25lmnv9e9c4c2gt6yd09m4xwmyjg7vy0823mqsgy4c0f6q7ptsl5c',
      8782,
      'Peer Study Buddy (Alex K.)',
      'peer',
    ),
  };

  // Try to read agent-addresses.json (written by run_agent_mesh.py)
  try {
    const addressesPath = join(process.cwd(), 'agent-addresses.json');
    const raw = await readFile(addressesPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.gateway) {
      agents.gateway = { ...agents.gateway, ...parsed.gateway, status: 'offline' };
    }
    if (parsed.buddy_user) {
      agents.buddy_user = { ...agents.buddy_user, ...parsed.buddy_user, status: 'offline' };
    }
    if (parsed.buddy_peer) {
      agents.buddy_peer = { ...agents.buddy_peer, ...parsed.buddy_peer, status: 'offline' };
    }
  } catch {
    // File not found — use defaults
  }

  // Probe orchestrator for liveness
  const orchestratorUrl = process.env.ORCHESTRATOR_URL || 'http://localhost:8765';
  try {
    const res = await fetch(`${orchestratorUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      agents.gateway.status = 'online';
    }
  } catch {
    // Not running
  }

  // Probe individual buddy agent ports
  const buddyKeys: (keyof AgentMap)[] = ['buddy_user', 'buddy_peer'];
  for (const key of buddyKeys) {
    const agent = agents[key];
    try {
      const res = await fetch(`http://localhost:${agent.port}/submit`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(2000),
      });
      if (res.status < 500) {
        agent.status = 'online';
      }
    } catch {
      // Not running
    }
  }

  return NextResponse.json({
    status: 'ok',
    agents,
    mesh_protocol: 'ChatMessage (uAgents Chat Protocol)',
    framework: 'Fetch.ai uAgents + ASI1-Mini',
    activity: [],
  });
}
