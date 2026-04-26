import { NextRequest, NextResponse } from 'next/server';

import { bearerFromHeader, verifyAuthToken } from '@/lib/auth/tokens';
import {
  findPairingBySession,
  findPhoneReport,
  listPhoneEvents,
  type PhoneEventRecord,
} from '@/lib/auth/store';

const PENALTY_BY_CLASS: Record<
  'glance' | 'off_task' | 'break_needed' | 'unknown',
  number
> = {
  glance: 2,
  off_task: 8,
  break_needed: 4,
  unknown: 5,
};

const FALLBACK_PENALTY = 5;
const MAX_PENALTY = 100;

function eventPenalty(event: PhoneEventRecord): number {
  if (event.type !== 'open') return 0;
  if (!event.inference) return FALLBACK_PENALTY;
  const base = PENALTY_BY_CLASS[event.inference.label] ?? FALLBACK_PENALTY;
  // The Melange-emitted penaltyScore is in [0, 1] (sigmoided). Scale into a
  // delta over the per-class base so a strong "doomscroll" signal hurts more
  // than a brief glance.
  const scaled = Math.max(0, Math.min(1, event.inference.penaltyScore));
  return Math.round(base * (0.5 + scaled));
}

export async function GET(req: NextRequest) {
  const token = bearerFromHeader(req.headers.get('authorization'));
  const payload = verifyAuthToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }

  const pairing = await findPairingBySession(sessionId);
  if (pairing && pairing.userId !== payload.uid) {
    return NextResponse.json(
      { error: 'session belongs to a different account' },
      { status: 403 },
    );
  }

  const [events, report] = await Promise.all([
    listPhoneEvents(sessionId),
    findPhoneReport(sessionId),
  ]);
  const opens = events.filter((e) => e.type === 'open');
  const closedDistractionMs = events
    .filter((e) => e.type === 'close' && typeof e.durationMs === 'number')
    .reduce((sum, e) => sum + (e.durationMs ?? 0), 0);
  const lastOpen = opens[opens.length - 1];
  // If the phone has been unlocked but not re-locked yet (i.e., the
  // last lifecycle event in the timeline is an `open`), the iOS
  // client hasn't posted a corresponding `close` with a `durationMs`
  // yet — so a naive sum would freeze the desktop's
  // "distracted" tile at the value from the previous unlock. Compute
  // the in-flight segment server-side using `Date.now()` so the
  // 5-second poll on the desktop ticks live like it did before.
  const lastEvent = events[events.length - 1];
  const inFlightMs =
    lastEvent && lastEvent.type === 'open'
      ? Math.max(0, Date.now() - lastEvent.timestamp)
      : 0;
  const totalDistractionMs = closedDistractionMs + inFlightMs;
  const productivityPenalty = Math.min(
    MAX_PENALTY,
    events.reduce((sum, e) => sum + eventPenalty(e), 0),
  );

  return NextResponse.json({
    paired: Boolean(pairing?.phoneDeviceId),
    sessionId,
    openCount: opens.length,
    totalDistractionMs,
    lastOpenAt: lastOpen?.timestamp ?? null,
    lastInference: lastOpen?.inference ?? null,
    productivityPenalty,
    events,
    report,
  });
}
