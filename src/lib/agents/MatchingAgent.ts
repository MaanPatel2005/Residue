/**
 * MatchingAgent — runs server-side via API route.
 *
 * Implements the Study Buddy Finder: queries MongoDB for users with
 * similar learned acoustic profiles using cosine similarity over their
 * EQ gain vectors. Filters by location radius and active session window.
 *
 * Architecture role (Fetch.ai pitch): This agent follows the uAgents
 * message protocol. A dedicated Python uAgents service
 * (scripts/matching_agent.py) provides the canonical Fetch.ai integration;
 * this TypeScript version serves as the fallback / proxied implementation.
 */

import type { MatchRequest, MatchResult, AgentMessage } from '@/lib/types/agents';

/**
 * Cosine similarity between two numeric vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Haversine distance in km between two lat/lng points.
 */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** User profile document as stored in MongoDB. */
interface StoredProfile {
  userId: string;
  name: string;
  eqVector: number[];
  optimalDbRange: [number, number];
  location?: { lat: number; lng: number; label: string };
  lastActive: number;
  currentlyStudying: boolean;
}

/**
 * Find matching study buddies from a list of stored profiles.
 * In production, `profiles` comes from MongoDB; for the MVP demo
 * this can also accept mock data.
 */
export function findMatches(
  request: MatchRequest,
  profiles: StoredProfile[]
): MatchResult[] {
  const { eqVector, location, radiusKm = 50, activeOnly = false } = request;

  let candidates = profiles.filter((p) => p.userId !== request.userId);

  // Filter by active status
  if (activeOnly) {
    candidates = candidates.filter((p) => p.currentlyStudying);
  }

  // Filter by location radius
  if (location) {
    candidates = candidates.filter((p) => {
      if (!p.location) return true; // include users without location
      return haversineKm(location.lat, location.lng, p.location.lat, p.location.lng) <= radiusKm;
    });
  }

  // Score by cosine similarity over EQ vectors
  const scored: MatchResult[] = candidates.map((p) => ({
    userId: p.userId,
    name: p.name,
    similarity: cosineSimilarity(eqVector, p.eqVector),
    optimalDbRange: p.optimalDbRange,
    eqVector: p.eqVector,
    location: p.location?.label,
    currentlyStudying: p.currentlyStudying,
    lastActive: p.lastActive,
  }));

  // Sort by similarity descending
  scored.sort((a, b) => b.similarity - a.similarity);

  return scored.slice(0, 10);
}

/**
 * Build an agent message following the uAgents protocol.
 */
export function buildMatchMessage(
  recipient: string,
  type: string,
  payload: MatchRequest | MatchResult[]
): AgentMessage<MatchRequest | MatchResult[]> {
  return {
    sender: 'agent://residue/matching',
    recipient,
    type,
    payload,
    timestamp: Date.now(),
  };
}
