import { NextRequest, NextResponse } from 'next/server';
import { randomInt } from 'node:crypto';

import { bearerFromHeader, verifyAuthToken } from '@/lib/auth/tokens';
import { upsertPairing } from '@/lib/auth/store';

const PAIRING_TTL_MS = 10 * 60 * 1000;

function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export async function POST(req: NextRequest) {
  const token = bearerFromHeader(req.headers.get('authorization'));
  const payload = verifyAuthToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: { sessionId?: string };
  try {
    body = (await req.json()) as { sessionId?: string };
  } catch {
    body = {};
  }
  const sessionId = body.sessionId?.trim();
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }

  const code = newCode();
  const now = Date.now();
  await upsertPairing({
    code,
    userId: payload.uid,
    sessionId,
    createdAt: now,
    expiresAt: now + PAIRING_TTL_MS,
  });
  return NextResponse.json({
    code,
    sessionId,
    expiresAt: now + PAIRING_TTL_MS,
  });
}
