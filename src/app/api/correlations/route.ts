import { NextRequest, NextResponse } from 'next/server';
import { getCorrelationsCollection, getProfilesCollection } from '@/lib/mongodb';

interface StoredCorrelation {
  id: string;
  userId: string;
  acousticProfile: unknown;
  productivitySnapshot: unknown;
  createdAt: number;
}

const correlationStore: StoredCorrelation[] = [];

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { userId, acousticProfile, productivitySnapshot } = body;

  const correlation: StoredCorrelation = {
    id: `corr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: userId || 'anon',
    acousticProfile,
    productivitySnapshot,
    createdAt: Date.now(),
  };

  try {
    const col = await getCorrelationsCollection();
    await col.insertOne(correlation);
    const profileCol = await getProfilesCollection();
    const bands = (acousticProfile?.frequencyBands ?? []) as { magnitude?: number }[];
    const eqVector = Array.from({ length: 7 }, (_, index) => bands[index]?.magnitude ?? 0);
    const overallDb = Number(acousticProfile?.overallDb ?? 0);

    // Only update acoustic profile when we have real microphone data (>10 dB).
    // Sessions with 0 dB indicate the microphone wasn't active and would
    // poison the profile with an unrealistic [0, 5] dB optimal range.
    const profileUpdate: Record<string, unknown> = {
      userId: correlation.userId,
      lastActive: correlation.createdAt,
      currentlyStudying: true,
      lastProductivityScore: productivitySnapshot?.productivityScore ?? null,
    };
    if (overallDb > 10) {
      profileUpdate.eqVector = eqVector;
      profileUpdate.optimalDbRange = [overallDb - 5, overallDb + 5];
    }

    await profileCol.updateOne(
      { userId: correlation.userId },
      { $set: profileUpdate },
      { upsert: true },
    );
  } catch {
    correlationStore.push(correlation);

    if (correlationStore.length > 1000) {
      correlationStore.splice(0, correlationStore.length - 1000);
    }
  }

  return NextResponse.json({ success: true, id: correlation.id });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId') || 'anon';
  const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);

  try {
    const col = await getCorrelationsCollection();
    const userCorrelations = await col
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    return NextResponse.json(userCorrelations.reverse());
  } catch {
    const userCorrelations = correlationStore
      .filter((c) => c.userId === userId)
      .slice(-limit);

    return NextResponse.json(userCorrelations);
  }
}
