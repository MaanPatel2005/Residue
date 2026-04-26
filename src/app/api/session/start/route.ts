import { NextRequest, NextResponse } from 'next/server';

import { bearerFromHeader, verifyAuthToken } from '@/lib/auth/tokens';
import { markSessionStarted } from '@/lib/auth/store';

/**
 * POST /api/session/start
 *
 * Mirrors `/api/session/stop` for the rising edge: flips
 * `user_data.studyStatus.currentlyStudying = true`, stamps `startedAt`,
 * and records `currentSessionId`. Called from the desktop's
 * "Start Session" button so the iOS companion's
 * `/api/phone/active-session` poll picks up the rising edge on the
 * next tick — without depending on the side-effect of an
 * acoustic/screen snapshot also being captured (which fails on
 * insecure-context dev origins where mic/screen capture is blocked).
 *
 * Body: { sessionId: string, mode?: string }
 * Auth: Bearer token (web app token; same secret as the phone token).
 */
export async function POST(req: NextRequest) {
  const token = bearerFromHeader(req.headers.get('authorization'));
  const payload = verifyAuthToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: { sessionId?: string; mode?: string } = {};
  try {
    body = (await req.json()) as { sessionId?: string; mode?: string };
  } catch {
    body = {};
  }

  if (!body.sessionId) {
    return NextResponse.json(
      { error: 'sessionId required' },
      { status: 400 },
    );
  }

  await markSessionStarted(payload.uid, body.sessionId, body.mode ?? null);
  return NextResponse.json({
    status: 'ok',
    sessionId: body.sessionId,
    startedAt: Date.now(),
  });
}
