import { NextRequest, NextResponse } from 'next/server';

import { bearerFromHeader, verifyAuthToken } from '@/lib/auth/tokens';
import { ensureUserAgent, findUserById } from '@/lib/auth/store';

/**
 * GET /api/agents/my-agent
 *
 * Returns the Study Buddy agent assigned to the authenticated user.
 * Requires a valid Bearer token. Returns 401 if unauthenticated.
 */
export async function GET(req: NextRequest) {
  const token = bearerFromHeader(req.headers.get('authorization'));
  const payload = verifyAuthToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const user = await findUserById(payload.uid);
  if (!user) {
    return NextResponse.json({ error: 'user not found' }, { status: 404 });
  }

  const assignment = await ensureUserAgent(user);

  return NextResponse.json({
    status: 'ok',
    agent: {
      address: assignment.buddyUser.address,
      handle: assignment.handle,
      port: assignment.buddyUser.port,
      name: 'Your Study Buddy',
      role: 'user',
      agentId: assignment.agentId,
      poolIndex: assignment.poolIndex,
    },
  });
}
