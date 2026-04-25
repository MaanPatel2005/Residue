/**
 * CorrelationAgent — runs server-side via API route.
 *
 * Long-running agent that consumes session data from MongoDB and
 * updates the user's personal acoustic-to-state model.
 * Runs on a 5-minute interval AND on demand.
 *
 * Architecture role (Cognition pitch): The learning agent that builds
 * the user's personal acoustic profile over time. Acoustic environment
 * is treated as a first-class input to the state model.
 */

import type {
  CorrelationUpdate,
  OptimalAcousticProfile,
  AgentMessage,
} from '@/lib/types/agents';
import type { AcousticStateCorrelation } from '@/types';

const DB_BUCKET_SIZE = 5;
const FREQUENCY_BAND_LABELS = [
  'Sub-bass', 'Bass', 'Low-mid', 'Mid', 'Upper-mid', 'Presence', 'Brilliance',
];

/**
 * Analyze a set of correlations and produce an optimal profile.
 * This runs server-side (API route) with full MongoDB access.
 */
export function buildOptimalProfile(
  correlations: AcousticStateCorrelation[]
): OptimalAcousticProfile | null {
  if (correlations.length < 3) return null;

  // Bucket correlations by dB level
  const dbBuckets = new Map<number, { totalProd: number; count: number }>();
  for (const c of correlations) {
    const bucket = Math.round(c.acousticProfile.overallDb / DB_BUCKET_SIZE) * DB_BUCKET_SIZE;
    const existing = dbBuckets.get(bucket) ?? { totalProd: 0, count: 0 };
    existing.totalProd += c.productivitySnapshot.productivityScore;
    existing.count++;
    dbBuckets.set(bucket, existing);
  }

  // Find optimal dB bucket
  let bestDb = 50;
  let bestAvg = 0;
  for (const [db, data] of dbBuckets) {
    const avg = data.totalProd / data.count;
    if (avg > bestAvg) {
      bestAvg = avg;
      bestDb = db;
    }
  }

  // Build 7-band EQ gain vector from high-productivity sessions
  const goodCorrelations = correlations.filter(
    (c) => c.productivitySnapshot.productivityScore >= 60
  );

  const eqGains = new Array(7).fill(0);
  const eqCounts = new Array(7).fill(0);

  for (const c of goodCorrelations) {
    for (let i = 0; i < c.acousticProfile.frequencyBands.length && i < 7; i++) {
      eqGains[i] += c.acousticProfile.frequencyBands[i].magnitude;
      eqCounts[i]++;
    }
  }

  for (let i = 0; i < 7; i++) {
    eqGains[i] = eqCounts[i] > 0 ? eqGains[i] / eqCounts[i] : 0;
  }

  // Find preferred bands (above-average magnitude)
  const avgGain = eqGains.reduce((a, b) => a + b, 0) / 7;
  const preferredBands = FREQUENCY_BAND_LABELS.filter((_, i) => eqGains[i] > avgGain);

  const confidence = Math.min(correlations.length / 20, 1);

  return {
    targetDb: bestDb,
    dbRange: [Math.max(0, bestDb - DB_BUCKET_SIZE), bestDb + DB_BUCKET_SIZE],
    eqGains,
    preferredBands,
    confidence,
  };
}

/**
 * Build a CorrelationUpdate message for inter-agent communication.
 */
export function buildCorrelationUpdate(
  userId: string,
  correlations: AcousticStateCorrelation[]
): CorrelationUpdate | null {
  const profile = buildOptimalProfile(correlations);
  if (!profile) return null;

  return {
    userId,
    optimalProfile: profile,
    dataPoints: correlations.length,
    lastUpdated: Date.now(),
  };
}

/**
 * Build an agent message following the uAgents protocol.
 */
export function buildAgentMessage<T>(
  recipient: string,
  type: string,
  payload: T
): AgentMessage<T> {
  return {
    sender: 'agent://residue/correlation',
    recipient,
    type,
    payload,
    timestamp: Date.now(),
  };
}
