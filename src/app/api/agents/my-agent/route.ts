import { NextRequest, NextResponse } from 'next/server';

import { bearerFromHeader, verifyAuthToken } from '@/lib/auth/tokens';
import { findUserById } from '@/lib/auth/store';
import { getAgentSet } from '@/lib/agents/pool';

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

  const setIndex = user.agentSetIndex ?? 0;
  const agentSet = getAgentSet(setIndex);

  return NextResponse.json({
    status: 'ok',
    agent: {
      address: agentSet.buddy_user.address,
      handle: agentSet.buddy_user.handle,
      port: agentSet.buddy_user.port,
      name: 'Your Study Buddy',
      role: 'user',
      agentSetIndex: setIndex,
    },
  });
}
