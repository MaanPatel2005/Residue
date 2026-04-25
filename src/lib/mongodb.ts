import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'residue';

let client: MongoClient | null = null;

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

export async function getUsersCollection() {
  const db = await getDb();
  return db.collection('users');
}

export async function getPhonePairingsCollection() {
  const db = await getDb();
  return db.collection('phone_pairings');
}

export async function getPhoneEventsCollection() {
  const db = await getDb();
  return db.collection('phone_events');
}
