import { NextRequest, NextResponse } from 'next/server';

import { bearerFromHeader, verifyAuthToken } from '@/lib/auth/tokens';
import { markSessionStopped } from '@/lib/auth/store';

/**
 * POST /api/session/stop
 *
 * Marks the user's study session as stopped in MongoDB
 * (`user_data.studyStatus.currentlyStudying = false`). The iOS companion
 * polls `/api/phone/active-session` and uses that flip as the trigger to
 * stop tracking and auto-generate the on-device Melange distraction
 * report.
 *
 * Body: { sessionId?: string }
 * Auth: Bearer token (web app token; same secret as the phone token).
 */
export async function POST(req: NextRequest) {
  const token = bearerFromHeader(req.headers.get('authorization'));
  const payload = verifyAuthToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: { sessionId?: string } = {};
  try {
    body = (await req.json()) as { sessionId?: string };
  } catch {
    body = {};
  }

  await markSessionStopped(payload.uid, body.sessionId ?? null);
  return NextResponse.json({
    status: 'ok',
    sessionId: body.sessionId ?? null,
    endedAt: Date.now(),
  });
}
