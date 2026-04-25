import { NextResponse } from 'next/server';
import { getAgentRunsCollection } from '@/lib/mongodb';

const ASI1_API_URL = 'https://api.asi1.ai/v1/chat/completions';
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8765';

interface OrchestrateBody {
  session_id: string;
  user_id: string;
  goal_mode: string;
  acoustic?: {
    overall_db: number;
    frequency_bands: number[];
    spectral_centroid: number;
    dominant_frequency: number;
  };
  behavioral?: {
    typing_speed: number;
    error_rate: number;
    inter_key_latency: number;
    mouse_jitter: number;
    scroll_velocity: number;
    focus_switch_rate: number;
  };
  sessions?: unknown[];
}

async function callASI1Mini(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = process.env.ASI1_API_KEY;
  if (!apiKey) return '';

  try {
    const response = await fetch(ASI1_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'asi1-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 300,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      const data = await response.json();
      return data.choices?.[0]?.message?.content ?? '';
    }
  } catch {
    // ASI1 not available
  }
  return '';
}

function parseASI1JSON(text: string): Record<string, unknown> | null {
  try {
    let jsonStr = text;
    if (jsonStr.includes('```json')) {
      jsonStr = jsonStr.split('```json')[1].split('```')[0].trim();
    } else if (jsonStr.includes('```')) {
      jsonStr = jsonStr.split('```')[1].split('```')[0].trim();
    }
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

async function recordAgentRun(
  body: OrchestrateBody,
  source: string,
  result: Record<string, unknown>,
): Promise<void> {
  try {
    const col = await getAgentRunsCollection();
    await col.insertOne({
      sessionId: body.session_id,
      userId: body.user_id,
      goalMode: body.goal_mode,
      source,
      request: {
        acoustic: body.acoustic ?? null,
        behavioral: body.behavioral ?? null,
        sessions: body.sessions ?? [],
      },
      result,
      createdAt: Date.now(),
    });
  } catch {
    // Agent responses should still return when MongoDB is unavailable.
  }
}

/**
 * POST /api/agents/orchestrate
 *
 * Full multi-agent pipeline: perception → correlation → intervention.
 * Tries the Python uAgents orchestrator first; falls back to in-process
 * ASI1-Mini calls if the Python service isn't running.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as OrchestrateBody;

    // Try the Python orchestrator first
    try {
      const pyResponse = await fetch(`${ORCHESTRATOR_URL}/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          acoustic: body.acoustic ? JSON.stringify(body.acoustic) : null,
          behavioral: body.behavioral ? JSON.stringify(body.behavioral) : null,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (pyResponse.ok) {
        const result = await pyResponse.json();
        await recordAgentRun(body, 'uagents', result as Record<string, unknown>);
        return NextResponse.json({ source: 'uagents', ...result });
      }
    } catch {
      // Python service not available, fall through to in-process
    }

    // In-process fallback using ASI1-Mini directly
    const acousticDesc = body.acoustic
      ? `${body.acoustic.overall_db.toFixed(1)} dB, bands: [${body.acoustic.frequency_bands.map((b) => b.toFixed(2)).join(', ')}]`
      : 'No acoustic data';

    const behavioralDesc = body.behavioral
      ? `typing ${body.behavioral.typing_speed.toFixed(0)} WPM, errors ${body.behavioral.error_rate.toFixed(1)}/min, jitter ${body.behavioral.mouse_jitter.toFixed(1)} px, focus switches ${body.behavioral.focus_switch_rate.toFixed(1)}/min`
      : 'No behavioral data';

    // Step 1: ASI1-Mini Perception
    const perceptionResult = await callASI1Mini(
      `You are Residue's Perception Agent analyzing acoustic + behavioral data to infer cognitive state.
Respond in JSON: {"cognitive_state": "focused"|"distracted"|"idle"|"transitioning", "confidence": 0-1, "reasoning": "brief explanation", "recommendation": "acoustic intervention suggestion"}`,
      `Goal: ${body.goal_mode}\nAcoustic: ${acousticDesc}\nBehavioral: ${behavioralDesc}`
    );

    let perception = {
      cognitive_state: 'idle',
      confidence: 0.5,
      reasoning: 'Using default state',
      recommendation: 'Start a session to begin tracking',
    };

    const parsedPerception = parseASI1JSON(perceptionResult);
    if (parsedPerception) {
      perception = {
        cognitive_state: (parsedPerception.cognitive_state as string) ?? 'idle',
        confidence: Math.min(Math.max(Number(parsedPerception.confidence ?? 0.5), 0), 1),
        reasoning: (parsedPerception.reasoning as string) ?? '',
        recommendation: (parsedPerception.recommendation as string) ?? '',
      };
    }

    // Step 2: ASI1-Mini Intervention
    const bedOptions = ['brown-noise', 'pink-noise', 'white-noise', 'rain', 'cafe', 'binaural'];
    const interventionResult = await callASI1Mini(
      `You are Residue's Intervention Agent. Given cognitive state and goal, pick the best ambient bed.
Available: ${bedOptions.join(', ')}
Respond in JSON: {"bed_selection": "one bed", "reasoning": "why", "eq_profile": [7 floats 0-1], "volume_target": 0-1}`,
      `State: ${perception.cognitive_state}, Goal: ${body.goal_mode}, Current: ${acousticDesc}`
    );

    let intervention = {
      bed_selection: 'brown-noise',
      reasoning: 'Default focus preset',
      eq_profile: [0.3, 0.4, 0.5, 0.3, 0.2, 0.1, 0.1],
      volume_target: 0.5,
    };

    const parsedIntervention = parseASI1JSON(interventionResult);
    if (parsedIntervention) {
      intervention = {
        bed_selection: bedOptions.includes(parsedIntervention.bed_selection as string)
          ? (parsedIntervention.bed_selection as string)
          : 'brown-noise',
        reasoning: (parsedIntervention.reasoning as string) ?? '',
        eq_profile: Array.isArray(parsedIntervention.eq_profile)
          ? (parsedIntervention.eq_profile as number[]).slice(0, 7)
          : intervention.eq_profile,
        volume_target: Math.min(Math.max(Number(parsedIntervention.volume_target ?? 0.5), 0), 1),
      };
    }

    const response = {
      source: 'asi1-mini-direct',
      perception,
      intervention,
      correlation: { insight: '', confidence: 0 },
      agent_addresses: {
        orchestrator: 'in-process',
        perception: 'asi1-mini',
        correlation: 'asi1-mini',
        intervention: 'asi1-mini',
      },
    };

    await recordAgentRun(body, response.source, response);
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  // Health check — also check if Python orchestrator is available
  let pythonStatus = 'unavailable';
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      pythonStatus = data.status ?? 'ok';
    }
  } catch {
    // not running
  }

  return NextResponse.json({
    status: 'ok',
    asi1_configured: !!process.env.ASI1_API_KEY,
    python_orchestrator: pythonStatus,
    agents: ['perception', 'correlation', 'intervention', 'orchestrator'],
  });
}
