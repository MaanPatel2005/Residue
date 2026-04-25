/**
 * Backing store for accounts, pairings, and phone events.
 *
 * Uses MongoDB when `MONGODB_URI` is set, otherwise an in-process Map so the
 * desktop ↔ phone pairing flow remains demo-able without an external DB. The
 * in-memory store is suitable for development and short-lived demos only.
 */

import type { Collection } from 'mongodb';

import {
  ensureMongoIndexes,
  getPhoneEventsCollection,
  getPhonePairingsCollection,
  getUserDataCollection,
  getUsersCollection,
} from '@/lib/mongodb';

// MongoDB's default Collection type narrows `_id` to ObjectId; we use string
// ids (`user-<uuid>`, 6-digit pairing codes, …) so we cast the collection to a
// loose `Collection<T>` shape per access. This keeps the existing
// `db.collection(name)` plumbing in lib/mongodb.ts unchanged.
const usersCol = async () =>
  (await getUsersCollection()) as unknown as Collection<UserRecord>;
const pairingsCol = async () =>
  (await getPhonePairingsCollection()) as unknown as Collection<PhonePairingRecord>;
const eventsCol = async () =>
  (await getPhoneEventsCollection()) as unknown as Collection<PhoneEventRecord>;
const userDataCol = async () =>
  (await getUserDataCollection()) as unknown as Collection<UserDataRecord>;

export interface UserRecord {
  _id: string;
  email: string;
  passwordHash: string;
  createdAt: number;
  updatedAt: number;
}

export interface UserDataRecord {
  userId: string;
  email: string;
  createdAt: number;
  updatedAt: number;
  profile: {
    displayName: string;
    goals: string[];
    preferredMode: 'focus' | 'calm' | 'creative' | 'social';
  };
  stats: {
    totalSessions: number;
    totalSnapshots: number;
    lastLoginAt: number | null;
    lastSessionAt: number | null;
  };
  hackathon: {
    atlasCollections: string[];
    prizeTrack: string;
  };
}

export interface PhonePairingRecord {
  code: string;
  userId: string;
  sessionId: string;
  createdAt: number;
  expiresAt: number;
  claimedAt?: number;
  phoneDeviceId?: string;
}

export type PhoneEventType = 'open' | 'close' | 'heartbeat';

export interface PhoneStateInference {
  label: 'glance' | 'off_task' | 'break_needed' | 'unknown';
  probabilities: Record<'glance' | 'off_task' | 'break_needed' | 'unknown', number>;
  penaltyScore: number;
  inferenceMs: number;
  executionProvider: string;
  modelVersion: string;
}

export interface PhoneEventRecord {
  sessionId: string;
  userId: string;
  type: PhoneEventType;
  timestamp: number;
  durationMs?: number;
  inference?: PhoneStateInference;
}

/**
 * Distraction report generated entirely on-device by the iOS companion's
 * Zetic Melange LLM. The text + per-category counters travel over the wire
 * so the desktop can render them, but the analysis itself is on-device.
 */
export interface PhoneReportRecord {
  sessionId: string;
  userId: string;
  summary: string;
  perCategoryMinutes: Record<string, number>;
  modelKey: string;
  inferenceMs: number;
  promptTokens: number;
  completionTokens: number;
  createdAt: number;
}

const mongoEnabled = (): boolean => Boolean(process.env.MONGODB_URI);

const memUsers = new Map<string, UserRecord>(); // key: email
const memUsersById = new Map<string, UserRecord>();
const memUserData = new Map<string, UserDataRecord>();
const memPairings = new Map<string, PhonePairingRecord>(); // key: code
const memEvents: PhoneEventRecord[] = [];
const memReports = new Map<string, PhoneReportRecord>(); // key: sessionId

// ── Users ───────────────────────────────────────────────────────────────────

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const normalized = email.trim().toLowerCase();
  if (mongoEnabled()) {
    const col = await usersCol();
    return (await col.findOne({ email: normalized })) ?? null;
  }
  return memUsers.get(normalized) ?? null;
}

export async function findUserById(uid: string): Promise<UserRecord | null> {
  if (mongoEnabled()) {
    const col = await usersCol();
    return (await col.findOne({ _id: uid })) ?? null;
  }
  return memUsersById.get(uid) ?? null;
}

export async function createUser(record: UserRecord): Promise<void> {
  const normalized = { ...record, email: record.email.trim().toLowerCase() };
  if (mongoEnabled()) {
    await ensureMongoIndexes();
    const col = await usersCol();
    await col.insertOne(normalized);
    return;
  }
  memUsers.set(normalized.email, normalized);
  memUsersById.set(normalized._id, normalized);
}

export async function ensureUserData(
  user: Pick<UserRecord, '_id' | 'email' | 'createdAt'>,
): Promise<UserDataRecord> {
  const now = Date.now();
  const displayName = user.email.split('@')[0] || 'Residue user';
  const defaults: UserDataRecord = {
    userId: user._id,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: now,
    profile: {
      displayName,
      goals: ['Build a personalized acoustic profile'],
      preferredMode: 'focus',
    },
    stats: {
      totalSessions: 0,
      totalSnapshots: 0,
      lastLoginAt: null,
      lastSessionAt: null,
    },
    hackathon: {
      atlasCollections: [
        'users',
        'user_data',
        'sessions_ts',
        'phone_pairings',
        'phone_events',
        'phone_reports',
      ],
      prizeTrack: 'Best Use of MongoDB Atlas',
    },
  };

  if (mongoEnabled()) {
    await ensureMongoIndexes();
    const col = await userDataCol();
    await col.updateOne(
      { userId: user._id },
      {
        $setOnInsert: defaults,
        $set: { email: user.email, updatedAt: now },
      },
      { upsert: true },
    );
    return (await col.findOne({ userId: user._id })) ?? defaults;
  }

  const existing = memUserData.get(user._id);
  if (existing) {
    const updated = { ...existing, email: user.email, updatedAt: now };
    memUserData.set(user._id, updated);
    return updated;
  }
  memUserData.set(user._id, defaults);
  return defaults;
}

export async function recordUserLogin(user: Pick<UserRecord, '_id' | 'email' | 'createdAt'>): Promise<void> {
  const now = Date.now();
  await ensureUserData(user);
  if (mongoEnabled()) {
    const col = await userDataCol();
    await col.updateOne(
      { userId: user._id },
      { $set: { email: user.email, updatedAt: now, 'stats.lastLoginAt': now } },
    );
    return;
  }
  const existing = memUserData.get(user._id);
  if (existing) {
    memUserData.set(user._id, {
      ...existing,
      email: user.email,
      updatedAt: now,
      stats: { ...existing.stats, lastLoginAt: now },
    });
  }
}

export async function recordUserSessionSnapshot(userId: string): Promise<void> {
  const now = Date.now();
  if (mongoEnabled()) {
    const col = await userDataCol();
    await col.updateOne(
      { userId },
      {
        $inc: { 'stats.totalSnapshots': 1 },
        $set: { updatedAt: now, 'stats.lastSessionAt': now },
      },
    );
    return;
  }
  const existing = memUserData.get(userId);
  if (existing) {
    memUserData.set(userId, {
      ...existing,
      updatedAt: now,
      stats: {
        ...existing.stats,
        totalSnapshots: existing.stats.totalSnapshots + 1,
        lastSessionAt: now,
      },
    });
  }
}

// ── Pairings ────────────────────────────────────────────────────────────────

export async function upsertPairing(record: PhonePairingRecord): Promise<void> {
  if (mongoEnabled()) {
    const col = await pairingsCol();
    await col.updateOne({ code: record.code }, { $set: record }, { upsert: true });
    return;
  }
  memPairings.set(record.code, record);
}

export async function findPairingByCode(
  code: string,
): Promise<PhonePairingRecord | null> {
  if (mongoEnabled()) {
    const col = await pairingsCol();
    return (await col.findOne({ code })) ?? null;
  }
  return memPairings.get(code) ?? null;
}

export async function findPairingBySession(
  sessionId: string,
): Promise<PhonePairingRecord | null> {
  if (mongoEnabled()) {
    const col = await pairingsCol();
    return (await col.findOne({ sessionId })) ?? null;
  }
  for (const p of memPairings.values()) {
    if (p.sessionId === sessionId) return p;
  }
  return null;
}

export async function claimPairing(
  code: string,
  phoneDeviceId: string,
): Promise<PhonePairingRecord | null> {
  const claimedAt = Date.now();
  if (mongoEnabled()) {
    const col = await pairingsCol();
    const result = (await col.findOneAndUpdate(
      { code },
      { $set: { phoneDeviceId, claimedAt } },
      { returnDocument: 'after' },
    )) as unknown as PhonePairingRecord | { value?: PhonePairingRecord } | null;
    if (!result) return null;
    if ('value' in (result as object)) {
      return (result as { value?: PhonePairingRecord }).value ?? null;
    }
    return result as PhonePairingRecord;
  }
  const existing = memPairings.get(code);
  if (!existing) return null;
  const updated: PhonePairingRecord = { ...existing, phoneDeviceId, claimedAt };
  memPairings.set(code, updated);
  return updated;
}

// ── Phone events ────────────────────────────────────────────────────────────

export async function appendPhoneEvent(record: PhoneEventRecord): Promise<void> {
  if (mongoEnabled()) {
    const col = await eventsCol();
    await col.insertOne(record);
    return;
  }
  memEvents.push(record);
}

export async function listPhoneEvents(
  sessionId: string,
): Promise<PhoneEventRecord[]> {
  if (mongoEnabled()) {
    const col = await eventsCol();
    return col.find({ sessionId }).sort({ timestamp: 1 }).toArray();
  }
  return memEvents.filter((e) => e.sessionId === sessionId);
}

// ── Phone reports (Melange-generated, on-device) ────────────────────────────

const reportsCol = async () => {
  const { getDb } = await import('@/lib/mongodb');
  return (await getDb()).collection(
    'phone_reports',
  ) as unknown as import('mongodb').Collection<PhoneReportRecord>;
};

export async function upsertPhoneReport(
  record: PhoneReportRecord,
): Promise<void> {
  if (mongoEnabled()) {
    const col = await reportsCol();
    await col.updateOne(
      { sessionId: record.sessionId },
      { $set: record },
      { upsert: true },
    );
    return;
  }
  memReports.set(record.sessionId, record);
}

export async function findPhoneReport(
  sessionId: string,
): Promise<PhoneReportRecord | null> {
  if (mongoEnabled()) {
    const col = await reportsCol();
    return (await col.findOne({ sessionId })) ?? null;
  }
  return memReports.get(sessionId) ?? null;
}
