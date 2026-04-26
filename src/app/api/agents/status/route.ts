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
  orchestrator: AgentInfo;
  perception: AgentInfo;
  correlation: AgentInfo;
  intervention: AgentInfo;
  residue: AgentInfo;
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

  const agents: AgentMap = {
    orchestrator: makeDefault(
      'agent1qvrm7en80z3ux283e3dg64c3gt3qn08ldx2gyap7fhnj537p64y4zgurlrn',
      8780,
      'Orchestrator',
      'orchestrator',
      'https://asi1.ai/chat',
    ),
    perception: makeDefault(
      'agent1qthdmuw6rslcwu3s36vxns4y2my0d4hpajj4deh68d68mhc0vsmkx3hgd8y',
      8781,
      'Perception Agent',
      'perception',
    ),
    correlation: makeDefault(
      'agent1qty4kcuvfdjs5dpscuv2nm6py9870prehp98yp4nk478rtmqa7pcynxw6l9',
      8782,
      'Correlation Agent',
      'correlation',
    ),
    intervention: makeDefault(
      'agent1q237netfmp8txn996ylxay08tlx79knl2f079anjaa8h0ssu49xq674e4lk',
      8783,
      'Intervention Agent',
      'intervention',
    ),
    residue: makeDefault(
      'agent1qd8w4add8w04sflvkvg537dp8zlryfqsap6vr0u3xd2tkn5xlu047waknlq',
      8784,
      'Residue',
      'residue',
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
  for (const key of ['perception', 'correlation', 'intervention', 'residue'] as const) {
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
