import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * POST /api/agents/similarity
 *
 * Computes a real similarity score between two users' acoustic profiles
 * using data from MongoDB sessions_ts. This powers the agent-to-agent
 * matching: each user's Study Buddy agent uses these real acoustic
 * embeddings when negotiating compatibility through ASI:One.
 *
 * Body: { user_a?: string, user_b?: string }
 *   - If omitted, auto-selects the two users with the most session data.
 *
 * Returns: {
 *   similarity: { score, eq_similarity, db_overlap, ... },
 *   profiles: { a: {...}, b: {...} },
 *   source: "mongodb_sessions"
 * }
 */

interface AcousticProfile {
  user_id: string;
  name: string;
  optimal_db: number;
  db_range: [number, number];
  eq_gains: number[];
  session_count: number;
  avg_productivity: number;
  preferred_bands: string[];
  avg_spectral_centroid: number;
}

const BAND_LABELS = [
  'Sub-bass (20-60Hz)',
  'Bass (60-250Hz)',
  'Low-mid (250-500Hz)',
  'Mid (500-2kHz)',
  'Upper-mid (2-4kHz)',
  'Presence (4-6kHz)',
  'Brilliance (6-20kHz)',
];

function extractMagnitude(band: unknown): number {
  if (typeof band === 'number') return band;
  if (band && typeof band === 'object' && 'magnitude' in band) {
    return Number((band as { magnitude: number }).magnitude);
  }
  return 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildProfile(db: any, userId: string): Promise<AcousticProfile | null> {
  const sessions = await db
    .collection('sessions_ts')
    .find({ user_id: userId })
    .sort({ timestamp: -1 })
    .limit(50)
    .toArray();

  if (sessions.length === 0) return null;

  const dbLevels: number[] = [];
  const eqSums = [0, 0, 0, 0, 0, 0, 0];
  let eqCount = 0;
  const productivityScores: number[] = [];
  const centroids: number[] = [];

  for (const sess of sessions) {
    const af = sess.acoustic_features as Record<string, unknown> | null;
    if (af) {
      if (af.overallDb != null) dbLevels.push(Number(af.overallDb));
      if (af.spectralCentroid != null) centroids.push(Number(af.spectralCentroid));
      const bands = af.frequencyBands as unknown[];
      if (Array.isArray(bands) && bands.length >= 7) {
        for (let i = 0; i < 7; i++) {
          eqSums[i] += extractMagnitude(bands[i]);
        }
        eqCount++;
      }
    }
    const ps = sess.productivity_score as number | null;
    if (ps != null) productivityScores.push(Number(ps));
  }

  const avgDb = dbLevels.length ? dbLevels.reduce((a, b) => a + b) / dbLevels.length : 50;
  const minDb = dbLevels.length ? Math.min(...dbLevels) : 40;
  const maxDb = dbLevels.length ? Math.max(...dbLevels) : 60;
  const eqGains = eqCount > 0 ? eqSums.map((s) => Math.round((s / eqCount) * 10000) / 10000) : [0, 0, 0, 0, 0, 0, 0];
  const avgProd = productivityScores.length ? productivityScores.reduce((a, b) => a + b) / productivityScores.length : 0;
  const avgCentroid = centroids.length ? centroids.reduce((a, b) => a + b) / centroids.length : 0;

  // Preferred bands: top 2
  const sorted = eqGains.map((g, i) => ({ g, i })).sort((a, b) => b.g - a.g);
  const preferredBands = sorted.slice(0, 2).map((x) => BAND_LABELS[x.i]);

  // Resolve user name
  let name = userId;
  try {
    const userData = await db.collection('user_data').findOne({ userId });
    if (userData?.profile?.displayName) {
      name = userData.profile.displayName as string;
    } else {
      const userDoc = await db.collection('users').findOne({ _id: userId });
      if (userDoc?.email) {
        name = (userDoc.email as string).split('@')[0];
      }
    }
  } catch {
    // name stays as userId
  }

  return {
    user_id: userId,
    name,
    optimal_db: Math.round(avgDb * 10) / 10,
    db_range: [Math.round(minDb * 10) / 10, Math.round(maxDb * 10) / 10],
    eq_gains: eqGains,
    session_count: sessions.length,
    avg_productivity: Math.round(avgProd),
    preferred_bands: preferredBands,
    avg_spectral_centroid: Math.round(avgCentroid * 10) / 10,
  };
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    let userA = (body as { user_a?: string }).user_a ?? '';
    let userB = (body as { user_b?: string }).user_b ?? '';

    const db = await getDb();

    // Auto-select users if not provided
    if (!userA || !userB) {
      const distinctUsers = await db.collection('sessions_ts').distinct('user_id') as string[];
      if (distinctUsers.length < 2) {
        return NextResponse.json({
          error: 'Need at least 2 users with session data for similarity comparison',
          available_users: distinctUsers,
        }, { status: 400 });
      }
      // Pick the two users with the most sessions
      const counts: { uid: string; count: number }[] = [];
      for (const uid of distinctUsers) {
        const count = await db.collection('sessions_ts').countDocuments({ user_id: uid });
        counts.push({ uid, count });
      }
      counts.sort((a, b) => b.count - a.count);
      userA = userA || counts[0].uid;
      userB = userB || counts[1].uid;
    }

    const [profileA, profileB] = await Promise.all([
      buildProfile(db, userA),
      buildProfile(db, userB),
    ]);

    if (!profileA || !profileB) {
      return NextResponse.json({
        error: 'One or both users have no acoustic session data',
        user_a: { id: userA, found: !!profileA },
        user_b: { id: userB, found: !!profileB },
      }, { status: 400 });
    }

    // Compute similarity metrics
    const eqSimilarity = cosineSimilarity(profileA.eq_gains, profileB.eq_gains);

    const dbOverlap = Math.max(
      0,
      Math.min(profileA.db_range[1], profileB.db_range[1]) -
        Math.max(profileA.db_range[0], profileB.db_range[0]),
    );
    const totalRange = Math.max(
      profileA.db_range[1] - profileA.db_range[0],
      profileB.db_range[1] - profileB.db_range[0],
      1,
    );
    const dbOverlapRatio = dbOverlap / totalRange;

    // Shared preferred bands
    const sharedBands = profileA.preferred_bands.filter((b) =>
      profileB.preferred_bands.includes(b),
    );
    const bandOverlap = sharedBands.length / Math.max(
      new Set([...profileA.preferred_bands, ...profileB.preferred_bands]).size, 1,
    );

    // Weighted composite score
    const score = eqSimilarity * 0.5 + dbOverlapRatio * 0.3 + bandOverlap * 0.2;

    // ASI1-Mini reasoning (if API key available)
    let reasoning = '';
    const asiKey = process.env.ASI1_API_KEY;
    if (asiKey) {
      try {
        const res = await fetch('https://api.asi1.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${asiKey}`,
          },
          body: JSON.stringify({
            model: 'asi1-mini',
            messages: [
              {
                role: 'system',
                content:
                  'You are a Study Buddy matching agent. Two students\' acoustic profiles ' +
                  'have been compared using REAL session data from MongoDB. Explain in 2-3 sentences ' +
                  'WHY they are compatible (or not), referencing specific acoustic preferences like ' +
                  'dB levels, frequency bands, and productivity scores. Be friendly and specific.',
              },
              {
                role: 'user',
                content: `Student A: ${JSON.stringify(profileA)}\nStudent B: ${JSON.stringify(profileB)}\nScores: eq_similarity=${eqSimilarity.toFixed(3)}, db_overlap=${dbOverlapRatio.toFixed(3)}, band_overlap=${bandOverlap.toFixed(3)}, composite=${score.toFixed(3)}`,
              },
            ],
            max_tokens: 200,
            temperature: 0.4,
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
          const data = await res.json();
          reasoning = data.choices?.[0]?.message?.content ?? '';
        }
      } catch {
        // ASI1-Mini not available
      }
    }

    return NextResponse.json({
      status: 'ok',
      similarity: {
        score: Math.round(score * 1000) / 1000,
        eq_similarity: Math.round(eqSimilarity * 1000) / 1000,
        db_overlap: Math.round(dbOverlapRatio * 1000) / 1000,
        band_overlap: Math.round(bandOverlap * 1000) / 1000,
        shared_bands: sharedBands,
        reasoning,
      },
      profiles: {
        a: profileA,
        b: profileB,
      },
      source: 'mongodb_sessions',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
