/**
 * MongoDB Time-Series Collection for Residue sessions.
 *
 * Uses Atlas time-series collections with:
 *   timeField: "timestamp"
 *   metaField: "user_id"
 *   granularity: "seconds"
 *
 * Each document captures a snapshot of the user's acoustic environment,
 * behavioral signals, cognitive state, goal mode, and active bed.
 */

import { getDb } from '@/lib/mongodb';
import type { SessionDocument } from '@/lib/types/profile';

const COLLECTION_NAME = 'sessions_ts';

/**
 * Ensure the time-series collection exists with correct configuration.
 * Safe to call multiple times — createCollection is a no-op if it exists.
 */
export async function ensureTimeseriesCollection(): Promise<void> {
  const db = await getDb();

  const collections = await db.listCollections({ name: COLLECTION_NAME }).toArray();
  if (collections.length > 0) return;

  try {
    await db.createCollection(COLLECTION_NAME, {
      timeseries: {
        timeField: 'timestamp',
        metaField: 'user_id',
        granularity: 'seconds',
      },
      expireAfterSeconds: 60 * 60 * 24 * 90, // 90 days retention
    });
  } catch (error) {
    // Collection may already exist in a non-Atlas environment
    const message = error instanceof Error ? error.message : '';
    if (!message.includes('already exists')) {
      throw error;
    }
  }
}

/**
 * Insert a session snapshot into the time-series collection.
 */
export async function insertSessionSnapshot(doc: SessionDocument): Promise<void> {
  const db = await getDb();
  const collection = db.collection(COLLECTION_NAME);
  await collection.insertOne({
    ...doc,
    timestamp: doc.timestamp instanceof Date ? doc.timestamp : new Date(doc.timestamp),
  });
}

/**
 * Query session snapshots for a user within a time range.
 */
export async function querySessionSnapshots(
  userId: string,
  startTime: Date,
  endTime: Date,
  limit: number = 100
): Promise<SessionDocument[]> {
  const db = await getDb();
  const collection = db.collection(COLLECTION_NAME);

  const results = await collection
    .find({
      user_id: userId,
      timestamp: { $gte: startTime, $lte: endTime },
    })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();

  return results as unknown as SessionDocument[];
}

/**
 * Get aggregated statistics for a user's sessions.
 * Groups by hour-of-day and computes average productivity.
 */
export async function getProductivityByHour(
  userId: string
): Promise<{ hour: number; avgProductivity: number; count: number }[]> {
  const db = await getDb();
  const collection = db.collection(COLLECTION_NAME);

  const pipeline = [
    { $match: { user_id: userId } },
    {
      $group: {
        _id: { $hour: '$timestamp' },
        avgProductivity: { $avg: '$productivity_score' },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 as const } },
    {
      $project: {
        hour: '$_id',
        avgProductivity: { $round: ['$avgProductivity', 1] },
        count: 1,
        _id: 0,
      },
    },
  ];

  const results = await collection.aggregate(pipeline).toArray();
  return results as { hour: number; avgProductivity: number; count: number }[];
}

/**
 * Get the total number of sessions and time span for a user.
 */
export async function getSessionStats(
  userId: string
): Promise<{ totalSessions: number; firstSession: Date | null; lastSession: Date | null }> {
  const db = await getDb();
  const collection = db.collection(COLLECTION_NAME);

  const pipeline = [
    { $match: { user_id: userId } },
    {
      $group: {
        _id: null,
        totalSessions: { $sum: 1 },
        firstSession: { $min: '$timestamp' },
        lastSession: { $max: '$timestamp' },
      },
    },
  ];

  const results = await collection.aggregate(pipeline).toArray();
  if (results.length === 0) {
    return { totalSessions: 0, firstSession: null, lastSession: null };
  }

  return {
    totalSessions: results[0].totalSessions as number,
    firstSession: results[0].firstSession as Date,
    lastSession: results[0].lastSession as Date,
  };
}
