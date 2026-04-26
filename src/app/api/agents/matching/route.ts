import { NextResponse } from 'next/server';
import { getProfilesCollection, getUserDataCollection, getUserAgentsCollection } from '@/lib/mongodb';
import { findMatches } from '@/lib/agents/MatchingAgent';
import type { MatchRequest } from '@/lib/types/agents';

/**
 * POST /api/agents/matching
 * Find study buddies with similar acoustic profiles.
 * Body: MatchRequest
 *
 * Queries real users from MongoDB only — no demo/mock data.
 * Cross-references user_data (emails), profiles (acoustic data),
 * and user_agents (agent addresses) to build real buddy entries.
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

    // Build profiles from real MongoDB data
    type ProfileEntry = {
      userId: string;
      name: string;
      eqVector: number[];
      optimalDbRange: [number, number];
      location?: { lat: number; lng: number; label: string };
      lastActive: number;
      currentlyStudying: boolean;
    };

    const profiles: ProfileEntry[] = [];

    try {
      const [userDataCol, profilesCol, userAgentsCol] = await Promise.all([
        getUserDataCollection(),
        getProfilesCollection(),
        getUserAgentsCollection(),
      ]);

      // Get all real users
      const allUsers = await userDataCol.find({}).limit(100).toArray();

      // Get profiles and agents for cross-referencing
      const allProfiles = await profilesCol.find({}).toArray();
      const allAgents = await userAgentsCol.find({}).toArray();

      const profileMap = new Map(allProfiles.map((p) => [p.userId as string, p]));
      const agentMap = new Map(allAgents.map((a) => [a.userId as string, a]));

      for (const user of allUsers) {
        const uid = user.userId as string;
        const email = user.email as string | undefined;

        // Skip test/placeholder accounts or records without email
        if (!email || email.endsWith('@residue.local')) continue;

        const profile = profileMap.get(uid);
        const agents = agentMap.get(uid);

        // Only show users who have registered agents (they are real active users)
        const hasAgents = agents &&
          (agents.orchestrator?.address || agents.perception?.address ||
           agents.correlation?.address || agents.intervention?.address);
        if (!hasAgents) continue;

        // Use email prefix as display name
        const displayName = (user.profile as { displayName?: string } | undefined)?.displayName
          ?? email.split('@')[0];

        profiles.push({
          userId: uid,
          name: displayName,
          eqVector: (profile?.optimalProfile?.eqGains as number[])
            ?? (profile?.eqVector as number[])
            ?? [0, 0, 0, 0, 0, 0, 0],
          optimalDbRange: (profile?.optimalProfile?.dbRange as [number, number])
            ?? (profile?.optimalDbRange as [number, number])
            ?? [40, 60],
          location: profile?.location as { lat: number; lng: number; label: string } | undefined,
          lastActive: (profile?.lastActive as number) ?? Date.now(),
          currentlyStudying: (profile?.currentlyStudying as boolean) ?? false,
        });
      }
    } catch {
      // MongoDB not available — return empty results (no fallback to mock data)
      return NextResponse.json({ source: 'mongodb', matches: [] });
    }

    const matches = findMatches(matchRequest, profiles);

    return NextResponse.json({
      source: 'mongodb',
      matches,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
