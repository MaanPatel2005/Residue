import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB || 'residue';

let client: MongoClient | null = null;
let indexSetup: Promise<void> | null = null;

export async function getMongoClient(): Promise<MongoClient> {
  if (!client) {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
  }
  return client;
}

export async function getDb() {
  const c = await getMongoClient();
  return c.db(DB_NAME);
}

export async function getCorrelationsCollection() {
  const db = await getDb();
  return db.collection('correlations');
}

export async function getProfilesCollection() {
  const db = await getDb();
  return db.collection('profiles');
}

export async function getSessionsCollection() {
  const db = await getDb();
  return db.collection('sessions');
}

export async function getAgentRunsCollection() {
  const db = await getDb();
  return db.collection('agent_runs');
}

export async function getUserAgentsCollection() {
  const db = await getDb();
  return db.collection('user_agents');
}

export async function getPerceptionStatesCollection() {
  const db = await getDb();
  return db.collection('perception_states');
}

export async function getUsersCollection() {
  const db = await getDb();
  return db.collection('users');
}

export async function getUserDataCollection() {
  const db = await getDb();
  return db.collection('user_data');
}

export async function getPhonePairingsCollection() {
  const db = await getDb();
  return db.collection('phone_pairings');
}

export async function getPhoneEventsCollection() {
  const db = await getDb();
  return db.collection('phone_events');
}

export async function ensureMongoIndexes(): Promise<void> {
  if (!indexSetup) {
    indexSetup = (async () => {
      const db = await getDb();
      await Promise.all([
        db.collection('users').createIndex({ email: 1 }, { unique: true }),
        db.collection('user_data').createIndex({ userId: 1 }, { unique: true }),
        db.collection('user_agents').createIndex({ userId: 1 }, { unique: true }),
        db.collection('user_agents').createIndex({ agentId: 1 }, { unique: true }),
        db.collection('agent_runs').createIndex({ userId: 1, createdAt: -1 }),
        db.collection('agent_runs').createIndex({ sessionId: 1 }),
        db.collection('correlations').createIndex({ userId: 1, createdAt: -1 }),
        db.collection('profiles').createIndex({ userId: 1, type: 1 }),
        db.collection('perception_states').createIndex({ userId: 1, timestamp: -1 }),
        db.collection('beds').createIndex({ userId: 1, generatedAt: -1 }),
        db.collection('phone_pairings').createIndex({ code: 1 }, { unique: true }),
        db.collection('phone_pairings').createIndex({ sessionId: 1 }),
        db.collection('phone_events').createIndex({ sessionId: 1, timestamp: 1 }),
        db.collection('phone_reports').createIndex({ sessionId: 1 }, { unique: true }),
      ]);
    })();
  }
  return indexSetup;
}
