import { NextRequest, NextResponse } from 'next/server';

import { bearerFromHeader, verifyAuthToken } from '@/lib/auth/tokens';
import { claimPairing, findPairingByCode } from '@/lib/auth/store';

export async function POST(req: NextRequest) {
  const token = bearerFromHeader(req.headers.get('authorization'));
  const payload = verifyAuthToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const { code, phoneDeviceId } = (await req.json()) as {
    code?: string;
    phoneDeviceId?: string;
  };
  if (!code || !phoneDeviceId) {
    return NextResponse.json(
      { error: 'code and phoneDeviceId required' },
      { status: 400 },
    );
  }

  const pairing = await findPairingByCode(code.trim());
  if (!pairing) {
    return NextResponse.json({ error: 'invalid code' }, { status: 404 });
  }
  if (pairing.userId !== payload.uid) {
    // Phone account must match desktop account.
    return NextResponse.json(
      { error: 'pairing belongs to a different account' },
      { status: 403 },
    );
  }
  if (pairing.expiresAt < Date.now()) {
    return NextResponse.json({ error: 'pairing code expired' }, { status: 410 });
  }
  const claimed = await claimPairing(code.trim(), phoneDeviceId);
  if (!claimed) {
    return NextResponse.json({ error: 'failed to claim pairing' }, { status: 500 });
  }
  return NextResponse.json({
    sessionId: claimed.sessionId,
    userId: claimed.userId,
    claimedAt: claimed.claimedAt,
  });
}
