/**
 * BedCache — caches generated ambient beds in MongoDB.
 *
 * On profile update, diffs against cached profiles using cosine distance.
 * Only regenerates if the fingerprint changed materially (cosine > 0.15).
 * Stores URL + prompt + profile fingerprint in a MongoDB collection.
 */

import { getDb } from '@/lib/mongodb';
import type { OptimalAcousticProfile } from '@/lib/types/agents';
import type { BedDocument, ProfileFingerprint } from '@/lib/types/profile';

const REGENERATION_THRESHOLD = 0.15; // cosine distance threshold

/**
 * Compute cosine distance between two vectors.
 * distance = 1 - cosine_similarity
 */
function cosineDistance(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 1;

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 1;
  return 1 - dot / denom;
}

/**
 * Build a fingerprint from a profile + mode for cache comparison.
 */
export function buildFingerprint(
  profile: OptimalAcousticProfile,
  mode: string
): ProfileFingerprint {
  return {
    eqVector: [...profile.eqGains],
    targetDb: profile.targetDb,
    mode,
  };
}

/**
 * Check if a cached bed's fingerprint differs materially from current profile.
 * Returns true if regeneration is needed.
 */
export function needsRegeneration(
  cached: ProfileFingerprint,
  current: ProfileFingerprint
): boolean {
  if (cached.mode !== current.mode) return true;
  if (Math.abs(cached.targetDb - current.targetDb) > 10) return true;
  return cosineDistance(cached.eqVector, current.eqVector) > REGENERATION_THRESHOLD;
}

/**
 * Get cached beds for a user from MongoDB.
 */
export async function getCachedBeds(userId: string): Promise<BedDocument[]> {
  const db = await getDb();
  const collection = db.collection<BedDocument>('beds');
  const beds = await collection
    .find({ userId })
    .sort({ generatedAt: -1 })
    .limit(10)
    .toArray();
  return beds as BedDocument[];
}

/**
 * Store a generated bed in the cache.
 */
export async function cacheBed(bed: BedDocument): Promise<void> {
  const db = await getDb();
  const collection = db.collection('beds');
  await collection.insertOne(bed);
}

/**
 * Get the most recent valid bed URL for a user + mode.
 * Returns null if no cached bed exists or if it needs regeneration.
 */
export async function getActiveBedUrl(
  userId: string,
  mode: string,
  currentProfile: OptimalAcousticProfile
): Promise<string | null> {
  const beds = await getCachedBeds(userId);
  const currentFp = buildFingerprint(currentProfile, mode);

  for (const bed of beds) {
    const cachedFp: ProfileFingerprint = {
      eqVector: bed.eqVector,
      targetDb: currentProfile.targetDb,
      mode: bed.mode,
    };

    if (!needsRegeneration(cachedFp, currentFp)) {
      return bed.url;
    }
  }

  return null;
}

/**
 * Clean up old cached beds for a user, keeping only the most recent N.
 */
export async function pruneCache(userId: string, keepCount: number = 10): Promise<void> {
  const db = await getDb();
  const collection = db.collection('beds');

  const beds = await collection
    .find({ userId })
    .sort({ generatedAt: -1 })
    .skip(keepCount)
    .toArray();

  if (beds.length > 0) {
    const ids = beds.map((b) => b._id);
    await collection.deleteMany({ _id: { $in: ids } });
  }
}
