import { NextRequest, NextResponse } from 'next/server';
import { Buffer } from 'node:buffer';

import {
  bearerFromHeader,
  createAuthToken,
  verifyAuthToken,
} from '@/lib/auth/tokens';
import {
  createUser,
  ensureUserData,
  findUserByEmail,
  findUserById,
  recordUserLogin,
  type UserRecord,
} from '@/lib/auth/store';
import { auth0 } from '@/auth0';

function auth0UserId(sub: string): string {
  return `auth0-${Buffer.from(sub).toString('base64url')}`;
}

async function ensureAuth0User(): Promise<UserRecord | null> {
  const session = await auth0.getSession();
  const profile = session?.user;
  if (!profile?.sub) return null;

  const email = profile.email?.trim().toLowerCase();
  if (!email) return null;

  const id = auth0UserId(profile.sub);
  const existingById = await findUserById(id);
  if (existingById) return existingById;

  const existingByEmail = await findUserByEmail(email);
  if (existingByEmail) return existingByEmail;

  const now = Date.now();
  const user: UserRecord = {
    _id: id,
    email,
    passwordHash: 'auth0',
    createdAt: now,
    updatedAt: now,
  };
  await createUser(user);
  return (await findUserById(id)) ?? user;
}

export async function GET(req: NextRequest) {
  const token = bearerFromHeader(req.headers.get('authorization'));
  const payload = verifyAuthToken(token);
  const user = payload
    ? await findUserById(payload.uid)
    : await ensureAuth0User();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (!payload) {
    await recordUserLogin(user);
  }
  const userData = await ensureUserData(user);
  return NextResponse.json({
    token: createAuthToken(user._id, user.email),
    user: { uid: user._id, email: user.email },
    userData,
  });
}
