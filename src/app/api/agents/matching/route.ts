import { NextResponse } from 'next/server';
import { getProfilesCollection } from '@/lib/mongodb';
import { findMatches } from '@/lib/agents/MatchingAgent';
import type { MatchRequest } from '@/lib/types/agents';

/** Mock profiles for demo when MongoDB is empty. */
const DEMO_PROFILES = [
  {
    userId: 'demo-alex',
    name: 'Alex K.',
    eqVector: [0.3, 0.4, 0.5, 0.4, 0.3, 0.2, 0.1],
    optimalDbRange: [40, 55] as [number, number],
    location: { lat: 34.0689, lng: -118.4452, label: 'UCLA Library' },
    lastActive: Date.now() - 120_000,
    currentlyStudying: true,
  },
  {
    userId: 'demo-sarah',
    name: 'Sarah M.',
    eqVector: [0.2, 0.3, 0.6, 0.5, 0.4, 0.3, 0.2],
    optimalDbRange: [45, 60] as [number, number],
    location: { lat: 34.0537, lng: -118.4368, label: 'Starbucks - Westwood' },
    lastActive: Date.now() - 300_000,
    currentlyStudying: true,
  },
  {
    userId: 'demo-james',
    name: 'James R.',
    eqVector: [0.5, 0.4, 0.3, 0.3, 0.2, 0.1, 0.1],
    optimalDbRange: [35, 50] as [number, number],
    location: { lat: 34.0700, lng: -118.4400, label: 'Home' },
    lastActive: Date.now() - 600_000,
    currentlyStudying: false,
  },
  {
    userId: 'demo-priya',
    name: 'Priya D.',
    eqVector: [0.2, 0.3, 0.4, 0.6, 0.5, 0.4, 0.3],
    optimalDbRange: [50, 65] as [number, number],
    location: { lat: 34.0195, lng: -118.4912, label: 'Coffee Bean - Santa Monica' },
    lastActive: Date.now() - 180_000,
    currentlyStudying: true,
  },
  {
    userId: 'demo-mike',
    name: 'Mike T.',
    eqVector: [0.4, 0.5, 0.4, 0.3, 0.2, 0.15, 0.1],
    optimalDbRange: [42, 58] as [number, number],
    location: { lat: 34.0715, lng: -118.4510, label: 'Dorm Room' },
    lastActive: Date.now() - 900_000,
    currentlyStudying: false,
  },
];

/**
 * POST /api/agents/matching
 * Find study buddies with similar acoustic profiles.
 * Body: MatchRequest
 *
 * Tries MongoDB first; falls back to demo profiles if no real users exist.
 * Also attempts to proxy to the Python uAgents service if AGENTVERSE_API_KEY
 * is configured.
 */
export async function POST(request: Request) {
  try {
    const matchRequest = (await request.json()) as MatchRequest;

    // Try the Python uAgents service first (Fetch.ai pitch)
    const agentverseKey = process.env.AGENTVERSE_API_KEY;
    if (agentverseKey) {
      try {
        const pyResponse = await fetch('http://localhost:8765/match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(matchRequest),
          signal: AbortSignal.timeout(3000),
        });
        if (pyResponse.ok) {
          const results = await pyResponse.json();
          return NextResponse.json({ source: 'uagents', matches: results });
        }
      } catch {
        // Python service not available, fall through to local matching
      }
    }

    // Try MongoDB profiles
    type ProfileEntry = {
      userId: string;
      name: string;
      eqVector: number[];
      optimalDbRange: [number, number];
      location?: { lat: number; lng: number; label: string };
      lastActive: number;
      currentlyStudying: boolean;
    };
    let profiles: ProfileEntry[] = DEMO_PROFILES;
    try {
      const profilesCol = await getProfilesCollection();
      const stored = await profilesCol.find({}).limit(50).toArray();
      if (stored.length > 0) {
        profiles = stored.map((p): ProfileEntry => ({
          userId: p.userId as string,
          name: (p.name as string) ?? 'Unknown',
          eqVector: (p.optimalProfile?.eqGains as number[]) ?? [0, 0, 0, 0, 0, 0, 0],
          optimalDbRange: (p.optimalProfile?.dbRange as [number, number]) ?? [40, 60],
          location: p.location as { lat: number; lng: number; label: string } | undefined,
          lastActive: (p.lastActive as number) ?? Date.now(),
          currentlyStudying: (p.currentlyStudying as boolean) ?? false,
        }));
      }
    } catch {
      // MongoDB not available, use demo profiles
    }

    const matches = findMatches(matchRequest, profiles);

    return NextResponse.json({
      source: profiles === DEMO_PROFILES ? 'demo' : 'mongodb',
      matches,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
