import { NextRequest, NextResponse } from 'next/server';

import { verifyPassword } from '@/lib/auth/passwords';
import { createAuthToken } from '@/lib/auth/tokens';
import { findUserByEmail } from '@/lib/auth/store';

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
    const user = await findUserByEmail(email);
    if (!user) {
      return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
    }
    const token = createAuthToken(user._id, user.email);
    return NextResponse.json({
      token,
      user: { uid: user._id, email: user.email },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
