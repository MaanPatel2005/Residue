import { NextRequest, NextResponse } from 'next/server';

import { bearerFromHeader, verifyAuthToken } from '@/lib/auth/tokens';

export async function GET(req: NextRequest) {
  const token = bearerFromHeader(req.headers.get('authorization'));
  const payload = verifyAuthToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  return NextResponse.json({
    user: { uid: payload.uid, email: payload.email },
  });
}
