import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { hashPassword } from '@/lib/auth/passwords';
import { createAuthToken } from '@/lib/auth/tokens';
import {
  createUser,
  ensureUserData,
  findUserByEmail,
  recordUserLogin,
} from '@/lib/auth/store';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = (await req.json()) as {
      email?: string;
      password?: string;
    };
    if (!email || !password) {
      return NextResponse.json(
        { error: 'email and password required' },
        { status: 400 },
      );
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: 'password must be at least 6 characters' },
        { status: 400 },
      );
    }
    const normalized = email.trim().toLowerCase();
    const existing = await findUserByEmail(normalized);
    if (existing) {
      return NextResponse.json(
        { error: 'account already exists for this email' },
        { status: 409 },
      );
    }
    const passwordHash = await hashPassword(password);
    const uid = `user-${randomUUID()}`;
    const user = {
      _id: uid,
      email: normalized,
      passwordHash,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await createUser(user);
    const userData = await ensureUserData(user);
    await recordUserLogin(user);
    const token = createAuthToken(uid, normalized);
    return NextResponse.json({
      token,
      user: { uid, email: normalized },
      userData,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
