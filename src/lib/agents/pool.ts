/**
 * Pre-defined pool of agent sets.
 *
 * Each set contains the 5 Agentverse-registered agents:
 *   orchestrator, perception, correlation, intervention, residue (hosted).
 *
 * When a new user registers they are assigned the next available set
 * (round-robin, wrapping at AGENT_POOL.length).
 */

export interface AgentSetEntry {
  orchestrator: { seed: string; address: string; port: number };
  perception: { seed: string; address: string; port: number };
  correlation: { seed: string; address: string; port: number };
  intervention: { seed: string; address: string; port: number };
}

/**
 * Pool of pre-defined agent sets.
 *
 * Set 0 = the live Agentverse-registered agents (all Active + Mailbox).
 */
export const AGENT_POOL: AgentSetEntry[] = [
  {
    orchestrator: {
      seed: 'residue-orchestrator',
      address: 'agent1qvrm7en80z3ux283e3dg64c3gt3qn08ldx2gyap7fhnj537p64y4zgurlrn',
      port: 8780,
    },
    perception: {
      seed: 'residue-perception',
      address: 'agent1qthdmuw6rslcwu3s36vxns4y2my0d4hpajj4deh68d68mhc0vsmkx3hgd8y',
      port: 8781,
    },
    correlation: {
      seed: 'residue-correlation',
      address: 'agent1qty4kcuvfdjs5dpscuv2nm6py9870prehp98yp4nk478rtmqa7pcynxw6l9',
      port: 8782,
    },
    intervention: {
      seed: 'residue-intervention',
      address: 'agent1q237netfmp8txn996ylxay08tlx79knl2f079anjaa8h0ssu49xq674e4lk',
      port: 8783,
    },
  },
];

/** Total number of agent sets in the pool. */
export const POOL_SIZE = AGENT_POOL.length;

/** Get the agent set for a given pool index (clamped to valid range). */
export function getAgentSet(index: number): AgentSetEntry {
  return AGENT_POOL[index % POOL_SIZE];
}
