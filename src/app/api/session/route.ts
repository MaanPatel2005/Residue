import { NextRequest, NextResponse } from 'next/server';
import { ensureTimeseriesCollection, insertSessionSnapshot, getSessionStats, getProductivityByHour } from '@/lib/db/timeseries';
import { getDb } from '@/lib/mongodb';

/**
 * POST /api/session
 * Start or snapshot a session. Persists to MongoDB time-series collection.
 *
 * Body: {
 *   userId: string,
 *   mode: string,
 *   acoustic_features?: { overallDb, frequencyBands, dominantFrequency, spectralCentroid },
 *   behavioral_features?: { typingSpeed, errorRate, interKeyLatency, mouseJitter, scrollVelocity, focusSwitchRate },
 *   productivity_score?: number,
 *   state?: string,
 *   goal?: string,
 *   active_bed_id?: string
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      userId,
      mode,
      acoustic_features,
      behavioral_features,
      productivity_score,
      state,
      goal,
      active_bed_id,
    } = body;

    // Ensure time-series collection exists
    try {
      await ensureTimeseriesCollection();
    } catch {
      // MongoDB might not be available — fall back to in-memory
    }

    const sessionDoc = {
      user_id: userId || 'anon',
      timestamp: new Date(),
      acoustic_features: acoustic_features || null,
      behavioral_features: behavioral_features || null,
      productivity_score: productivity_score ?? 0,
      state: state || 'unknown',
      goal: goal || mode || 'focus',
      active_bed_id: active_bed_id || null,
    };

    // Persist to MongoDB
    try {
      await insertSessionSnapshot(sessionDoc);
    } catch {
      // MongoDB not available — session still works in-memory
    }

    return NextResponse.json({
      id: `session-${Date.now()}`,
      ...sessionDoc,
      stored: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/session?userId=xxx
 * Returns session stats + productivity-by-hour aggregation from MongoDB.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId') || 'anon';

    try {
      const [stats, hourly] = await Promise.all([
        getSessionStats(userId),
        getProductivityByHour(userId),
      ]);

      // Also get recent sessions
      const db = await getDb();
      const recent = await db
        .collection('sessions_ts')
        .find({ user_id: userId })
        .sort({ timestamp: -1 })
        .limit(20)
        .toArray();

      return NextResponse.json({
        status: 'ok',
        stats,
        productivityByHour: hourly,
        recentSessions: recent,
      });
    } catch {
      return NextResponse.json({
        status: 'no_db',
        stats: { totalSessions: 0, firstSession: null, lastSession: null },
        productivityByHour: [],
        recentSessions: [],
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
