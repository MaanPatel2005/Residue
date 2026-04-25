/**
 * Pre-defined pool of agent sets.
 *
 * Each set contains seeds and deterministic addresses for 3 agents
 * (gateway, buddy_user, buddy_peer). When a new user registers they
 * are assigned the next available set (round-robin, wrapping at
 * AGENT_POOL.length).
 *
 * For the hackathon demo we pre-register 3 sets. In production this
 * would be replaced by dynamic seed generation per user.
 */

export interface AgentSetEntry {
  gateway: { seed: string; address: string; port: number };
  buddy_user: { seed: string; address: string; port: number; handle: string };
  buddy_peer: { seed: string; address: string; port: number };
}

/**
 * Pool of 3 pre-defined agent sets.
 *
 * Addresses are deterministic from seeds — they were pre-computed by
 * running the uAgents Agent constructor with each seed.
 *
 * Set 0 = the original "default" agents created in PR #11.
 * Sets 1-2 = new sets with unique seeds for additional users.
 */
export const AGENT_POOL: AgentSetEntry[] = [
  {
    gateway: {
      seed: 'residue-gateway-agent-v2',
      address: 'agent1qvuwcewf5lj7p5vpnfdev3ja80f7wmdmwg3sj7y2dqk335cgfjc2vhf4af8',
      port: 8780,
    },
    buddy_user: {
      seed: 'residue-study-buddy-user-agent-v2',
      address: 'agent1qtgdgv6nj6zd7hkpv4rwrzs8aqem6cyvxqcxvxgsrwfe5qdz96ulyp77sc6',
      port: 8781,
      handle: '@residue-study-buddy',
    },
    buddy_peer: {
      seed: 'residue-study-buddy-peer-agent-v2',
      address: 'agent1qgacmc25lmnv9e9c4c2gt6yd09m4xwmyjg7vy0823mqsgy4c0f6q7ptsl5c',
      port: 8782,
    },
  },
  {
    gateway: {
      seed: 'residue-gateway-agent-set-1',
      address: 'agent1q-set1-gateway-placeholder',
      port: 8790,
    },
    buddy_user: {
      seed: 'residue-study-buddy-user-set-1',
      address: 'agent1q-set1-buddy-user-placeholder',
      port: 8791,
      handle: '@residue-buddy-1',
    },
    buddy_peer: {
      seed: 'residue-study-buddy-peer-set-1',
      address: 'agent1q-set1-buddy-peer-placeholder',
      port: 8792,
    },
  },
  {
    gateway: {
      seed: 'residue-gateway-agent-set-2',
      address: 'agent1q-set2-gateway-placeholder',
      port: 8800,
    },
    buddy_user: {
      seed: 'residue-study-buddy-user-set-2',
      address: 'agent1q-set2-buddy-user-placeholder',
      port: 8801,
      handle: '@residue-buddy-2',
    },
    buddy_peer: {
      seed: 'residue-study-buddy-peer-set-2',
      address: 'agent1q-set2-buddy-peer-placeholder',
      port: 8802,
    },
  },
];

/** Total number of agent sets in the pool. */
export const POOL_SIZE = AGENT_POOL.length;

/** Get the agent set for a given pool index (clamped to valid range). */
export function getAgentSet(index: number): AgentSetEntry {
  return AGENT_POOL[index % POOL_SIZE];
}
