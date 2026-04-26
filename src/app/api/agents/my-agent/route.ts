import { NextRequest, NextResponse } from 'next/server';

import { bearerFromHeader, verifyAuthToken } from '@/lib/auth/tokens';
import { ensureUserAgent, findUserById } from '@/lib/auth/store';

/**
 * GET /api/agents/my-agent
 *
 * Returns all agents assigned to the authenticated user.
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
    agents: {
      orchestrator: {
        address: assignment.orchestrator.address,
        port: assignment.orchestrator.port,
        name: 'Orchestrator',
        role: 'orchestrator',
      },
      perception: {
        address: assignment.perception.address,
        port: assignment.perception.port,
        name: 'Perception Agent',
        role: 'perception',
      },
      correlation: {
        address: assignment.correlation.address,
        port: assignment.correlation.port,
        name: 'Correlation Agent',
        role: 'correlation',
      },
      intervention: {
        address: assignment.intervention.address,
        port: assignment.intervention.port,
        name: 'Intervention Agent',
        role: 'intervention',
      },
      residue: {
        address: assignment.residue.address,
        port: assignment.residue.port,
        name: 'Residue',
        role: 'residue',
      },
    },
  });
}
