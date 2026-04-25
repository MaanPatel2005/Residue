import { NextRequest, NextResponse } from 'next/server';

import { bearerFromHeader, verifyAuthToken } from '@/lib/auth/tokens';
import {
  appendPhoneEvent,
  findPairingBySession,
  type PhoneEventType,
  type PhoneStateInference,
} from '@/lib/auth/store';

const VALID_TYPES: ReadonlySet<PhoneEventType> = new Set([
  'open',
  'close',
  'heartbeat',
]);

export async function POST(req: NextRequest) {
  const token = bearerFromHeader(req.headers.get('authorization'));
  const payload = verifyAuthToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const body = (await req.json()) as {
    sessionId?: string;
    type?: PhoneEventType;
    timestamp?: number;
    durationMs?: number;
    inference?: PhoneStateInference;
  };
  const { sessionId, type } = body;
  if (!sessionId || !type || !VALID_TYPES.has(type)) {
    return NextResponse.json(
      { error: 'sessionId and a valid type required' },
      { status: 400 },
    );
  }

  const pairing = await findPairingBySession(sessionId);
  if (!pairing) {
    return NextResponse.json({ error: 'session not paired' }, { status: 404 });
  }
  if (pairing.userId !== payload.uid) {
    return NextResponse.json(
      { error: 'session belongs to a different account' },
      { status: 403 },
    );
  }

  await appendPhoneEvent({
    sessionId,
    userId: payload.uid,
    type,
    timestamp: body.timestamp ?? Date.now(),
    durationMs: body.durationMs,
    inference: body.inference,
  });
  return NextResponse.json({ status: 'ok' });
}
