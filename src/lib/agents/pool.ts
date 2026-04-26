/**
 * Pre-defined pool of agent sets.
 *
 * Each set contains 4 Agentverse agents:
 *   orchestrator, perception, correlation, intervention.
 *
 * When a new user registers they are assigned the next available set
 * (round-robin, wrapping at AGENT_POOL.length).
 *
 * Set 0 = live Agentverse-registered agents (Active + Mailbox).
 * Sets 1-2 = additional unique agent sets (register on Agentverse to activate).
 */

export interface AgentSetEntry {
  orchestrator: { seed: string; address: string; port: number };
  perception: { seed: string; address: string; port: number };
  correlation: { seed: string; address: string; port: number };
  intervention: { seed: string; address: string; port: number };
}

export const AGENT_POOL: AgentSetEntry[] = [
  // Set 0 — live Agentverse agents
  {
    orchestrator: {
      seed: 'residue-orchestrator-agent-seed-phrase-v1',
      address: 'agent1qvrm7en80z3ux283e3dg64c3gt3qn08ldx2gyap7fhnj537p64y4zgurlrn',
      port: 8773,
    },
    perception: {
      seed: 'residue-perception-agent-seed-phrase-v1',
      address: 'agent1qthdmuw6rslcwu3s36vxns4y2my0d4hpajj4deh68d68mhc0vsmkx3hgd8y',
      port: 8770,
    },
    correlation: {
      seed: 'residue-correlation-agent-seed-phrase-v1',
      address: 'agent1qtwzl3rs7jekz04zaa3u3hwkwukhq55qq4t7svsxm5qvxs6nzc5aq0vr0st',
      port: 8771,
    },
    intervention: {
      seed: 'residue-intervention-agent-seed-phrase-v1',
      address: 'agent1q237netfmp8txn996ylxay08tlx79knl2f079anjaa8h0ssu49xq674e4lk',
      port: 8772,
    },
  },
  // Set 1 — unique agents for second user
  {
    orchestrator: {
      seed: 'residue-orchestrator-agent-seed-phrase-v2',
      address: 'agent1qgh3r2k0c8ff888svhj4ajsvjlgxzme4sx6ylwdhnk8ql3jda9kdjumyndu',
      port: 8783,
    },
    perception: {
      seed: 'residue-perception-agent-seed-phrase-v2',
      address: 'agent1qt9tltqvlgyen2j3m5yuaq7ctx45vxntxjzhxvug7qkdxcn0fu4dyxf5h58',
      port: 8780,
    },
    correlation: {
      seed: 'residue-correlation-agent-seed-phrase-v2',
      address: 'agent1qd0tkvv83y0q6lg956srg7v5plvxdhh3ek7jsfhpyx0wnf3gejjqjr9jrsg',
      port: 8781,
    },
    intervention: {
      seed: 'residue-intervention-agent-seed-phrase-v2',
      address: 'agent1qgagkawpy6f00kj20a6wrhgf0mf7usxzpyzxrn76s348gz0m4e26vylvddc',
      port: 8782,
    },
  },
  // Set 2 — unique agents for third user
  {
    orchestrator: {
      seed: 'residue-orchestrator-agent-seed-phrase-v3',
      address: 'agent1q2kwnxk7ykt6r9tlhgjdpg36eez4k3p357w8w3x9gytj2zp9ef7u7q3udv4',
      port: 8793,
    },
    perception: {
      seed: 'residue-perception-agent-seed-phrase-v3',
      address: 'agent1qftgkfq0g2egq39a9u2ddfhj2fq67y38atzueyskd034fa0j2w99wpl6u3q',
      port: 8790,
    },
    correlation: {
      seed: 'residue-correlation-agent-seed-phrase-v3',
      address: 'agent1qdgx4p4p0lyg26cxgm9v7xaa7zhzmcwn3srfe6pqcx6e95ssfm04s45alss',
      port: 8791,
    },
    intervention: {
      seed: 'residue-intervention-agent-seed-phrase-v3',
      address: 'agent1q0n908slehmfw6rj29zlkm597xxgqezl6lky0xn9mf7qcm29wmz7z7yllak',
      port: 8792,
    },
  },
];

/** Total number of agent sets in the pool. */
export const POOL_SIZE = AGENT_POOL.length;

/** Get the agent set for a given pool index (clamped to valid range). */
export function getAgentSet(index: number): AgentSetEntry {
  return AGENT_POOL[index % POOL_SIZE];
}
