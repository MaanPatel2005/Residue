import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';

import { AGENT_POOL } from '@/lib/agents/pool';

interface AgentInfo {
  address: string;
  port: number;
  name: string;
  role: string;
  chat_url?: string;
  status: 'online' | 'offline';
}

interface AgentMap {
  orchestrator: AgentInfo;
  perception: AgentInfo;
  correlation: AgentInfo;
  intervention: AgentInfo;
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

  const set0 = AGENT_POOL[0];
  const agents: AgentMap = {
    orchestrator: makeDefault(
      set0.orchestrator.address,
      set0.orchestrator.port,
      'Orchestrator',
      'orchestrator',
      'https://asi1.ai/chat',
    ),
    perception: makeDefault(
      set0.perception.address,
      set0.perception.port,
      'Perception Agent',
      'perception',
    ),
    correlation: makeDefault(
      set0.correlation.address,
      set0.correlation.port,
      'Correlation Agent',
      'correlation',
    ),
    intervention: makeDefault(
      set0.intervention.address,
      set0.intervention.port,
      'Intervention Agent',
      'intervention',
    ),
  };

  // Try to read agent-addresses.json (written by run_agent_mesh.py)
  try {
    const addressesPath = join(process.cwd(), 'agent-addresses.json');
    const raw = await readFile(addressesPath, 'utf-8');
    const parsed = JSON.parse(raw);
    for (const key of Object.keys(agents) as (keyof AgentMap)[]) {
      if (parsed[key]) {
        agents[key] = { ...agents[key], ...parsed[key], status: 'offline' };
      }
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
      agents.orchestrator.status = 'online';
    }
  } catch {
    // Not running
  }

  // Probe individual agent ports
  for (const key of ['perception', 'correlation', 'intervention'] as const) {
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
