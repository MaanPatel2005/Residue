import { NextResponse } from 'next/server';
import { getCorrelationsCollection, getProfilesCollection } from '@/lib/mongodb';
import { buildCorrelationUpdate } from '@/lib/agents/CorrelationAgent';
import type { AcousticStateCorrelation } from '@/types';

/**
 * POST /api/agents/correlation
 * Triggers the CorrelationAgent to rebuild a user's optimal profile.
 * Body: { userId: string }
 */
export async function POST(request: Request) {
  try {
    const { userId } = (await request.json()) as { userId: string };
    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    const correlationsCol = await getCorrelationsCollection();
    const correlations = (await correlationsCol
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray()) as unknown as AcousticStateCorrelation[];

    const update = buildCorrelationUpdate(userId, correlations);
    if (!update) {
      return NextResponse.json({
        status: 'insufficient_data',
        dataPoints: correlations.length,
        minimumRequired: 3,
      });
    }

    // Persist the updated profile
    const profilesCol = await getProfilesCollection();
    await profilesCol.updateOne(
      { userId },
      {
        $set: {
          userId,
          optimalProfile: update.optimalProfile,
          dataPoints: update.dataPoints,
          lastUpdated: update.lastUpdated,
        },
      },
      { upsert: true }
    );

    return NextResponse.json({
      status: 'updated',
      update,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/agents/correlation?userId=xxx
 * Returns the current correlation update / optimal profile for a user.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    const profilesCol = await getProfilesCollection();
    const profile = await profilesCol.findOne({ userId });

    if (!profile) {
      return NextResponse.json({ status: 'no_profile', userId });
    }

    return NextResponse.json({ status: 'ok', profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
