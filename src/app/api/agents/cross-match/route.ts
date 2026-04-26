import { NextRequest, NextResponse } from 'next/server';

import { bearerFromHeader, verifyAuthToken } from '@/lib/auth/tokens';
import { findUserById } from '@/lib/auth/store';

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8765';

/**
 * The acoustic profile of a matched candidate, as nested under each match.
 * Mirrors scripts/agents/correlation_agent.py::_serialize_match's
 * `candidate_profile` block.
 */
export interface CandidateProfile {
  optimal_db?: number | null;
  db_range?: [number, number] | null;
  eq_gains?: number[] | null;
  preferred_bands?: string[] | null;
  preferred_sounds?: string[] | null;
  confidence?: number | null;
  study_hours?: string | null;
  focus_score_avg?: number | null;
  location?: string | null;
}

/**
 * Match payload returned by the Python CorrelationAgent
 * (see scripts/agents/correlation_agent.py::_serialize_match).
 */
export interface CrossAgentMatch {
  user_id: string;
  agent_address?: string | null;
  compatibility_score: number;
  eq_similarity: number;
  db_overlap: number;
  sound_overlap: number;
  shared_sounds: string[];
  shared_bands: string[];
  vector_score?: number | null;
  reasoning: string;
  candidate_profile?: CandidateProfile;
}

/**
 * Wire shape of POST /api/agents/cross-match.
 * Exported so client components can import the same definition.
 */
export interface CrossMatchResponse {
  user_id: string;
  top_k: number;
  matches: CrossAgentMatch[];
  source: 'agent' | 'sync_fallback';
  agent_addresses?: {
    orchestrator?: string;
    correlation?: string;
  };
}

/**
 * POST /api/agents/cross-match
 *
 * Proxies to the Python orchestrator's `/match` endpoint, which runs the
 * cross-agent CorrelationAgent matching pipeline:
 *   FindMatchesRequest -> vector_search -> compute_compatibility ->
 *   bidirectional ProfileExchangeRequest/Response -> ranked matches
 *
 * Each match includes the full compatibility breakdown (eq_similarity,
 * db_overlap, sound_preference_overlap, shared_sounds, shared_bands) plus
 * ASI1-Mini-generated reasoning text.
 *
 * Requires a valid Bearer token. The user_id is taken from the auth payload
 * — clients cannot request matches on someone else's behalf.
 */
export async function POST(req: NextRequest) {
  const token = bearerFromHeader(req.headers.get('authorization'));
  const payload = verifyAuthToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const user = await findUserById(payload.uid);
  if (!user) {
    return NextResponse.json({ error: 'user not found' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { top_k?: number };
  const topK = Math.max(1, Math.min(20, Number(body.top_k) || 5));

  try {
    const pyResponse = await fetch(`${ORCHESTRATOR_URL}/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user._id, top_k: topK }),
      signal: AbortSignal.timeout(45000),
    });

    if (!pyResponse.ok) {
      // Log only a bounded preview of the orchestrator response server-side for
      // debugging, but never forward raw stack traces or internal diagnostics
      // to the client.
      const text = await pyResponse.text().catch(() => '');
      const textPreview = text.slice(0, 500);
      console.error('[cross-match] orchestrator returned error', {
        status: pyResponse.status,
        bodyPreview: textPreview,
      });
      return NextResponse.json(
        {
          error: 'orchestrator_error',
          status: pyResponse.status,
          detail:
            process.env.NODE_ENV !== 'production'
              ? textPreview
              : 'The matching service returned an error. Please try again.',
        },
        { status: 502 },
      );
    }

    const result = (await pyResponse.json()) as CrossMatchResponse;
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const isProd = process.env.NODE_ENV === 'production';
    return NextResponse.json(
      {
        error: 'orchestrator_unreachable',
        detail: isProd
          ? 'The matching service is not reachable. Please try again later.'
          : message,
        hint: isProd
          ? undefined
          : `Make sure the Python orchestrator is running on ${ORCHESTRATOR_URL}. Run: python scripts/agents/orchestrator_agent.py`,
      },
      { status: 503 },
    );
  }
}
