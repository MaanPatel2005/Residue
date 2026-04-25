import { NextResponse } from 'next/server';
import { getProfilesCollection, getCorrelationsCollection } from '@/lib/mongodb';
import { buildProfileFromCorrelations, updateProfile } from '@/lib/personalization/BayesianProfile';
import type { AcousticStateCorrelation } from '@/types';

/**
 * GET /api/profiles?userId=xxx
 * Returns the user's Bayesian profile.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    try {
      const profilesCol = await getProfilesCollection();
      const profile = await profilesCol.findOne({ userId, type: 'bayesian' });

      if (profile) {
        return NextResponse.json({ status: 'ok', profile });
      }
    } catch {
      // MongoDB not available
    }

    return NextResponse.json({ status: 'no_profile', userId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/profiles
 * Build or update a Bayesian profile from correlations.
 * Body: { userId: string, rebuild?: boolean }
 */
export async function POST(request: Request) {
  try {
    const { userId, rebuild = false } = (await request.json()) as {
      userId: string;
      rebuild?: boolean;
    };

    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    const correlationsCol = await getCorrelationsCollection();
    const correlations = (await correlationsCol
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray()) as unknown as AcousticStateCorrelation[];

    if (correlations.length === 0) {
      return NextResponse.json({
        status: 'insufficient_data',
        message: 'No correlations found for this user',
      });
    }

    // Build or rebuild the Bayesian profile
    const bayesianProfile = buildProfileFromCorrelations(userId, correlations);

    // Persist
    try {
      const profilesCol = await getProfilesCollection();
      await profilesCol.updateOne(
        { userId, type: 'bayesian' },
        { $set: { ...bayesianProfile, type: 'bayesian' } },
        { upsert: true }
      );
    } catch {
      // MongoDB not available
    }

    return NextResponse.json({
      status: 'ok',
      profile: bayesianProfile,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
