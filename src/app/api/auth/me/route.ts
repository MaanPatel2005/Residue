import { NextRequest, NextResponse } from 'next/server';

import { bearerFromHeader, verifyAuthToken } from '@/lib/auth/tokens';
import { ensureUserData, findUserById } from '@/lib/auth/store';

export async function GET(req: NextRequest) {
  const token = bearerFromHeader(req.headers.get('authorization'));
  const payload = verifyAuthToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const user = await findUserById(payload.uid);
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userData = await ensureUserData(user);
  return NextResponse.json({
    user: { uid: user._id, email: user.email },
    userData,
  });
}
