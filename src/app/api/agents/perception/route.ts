import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import type { PerceptionState } from '@/lib/types/agents';

/**
 * POST /api/agents/perception
 * Persists a perception state snapshot to MongoDB for historical analysis.
 * Called periodically by the client-side PerceptionAgent.
 */
export async function POST(request: Request) {
  try {
    const { userId, state } = (await request.json()) as {
      userId: string;
      state: PerceptionState;
    };

    if (!userId || !state) {
      return NextResponse.json(
        { error: 'userId and state required' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const collection = db.collection('perception_states');

    await collection.insertOne({
      userId,
      cognitiveState: state.cognitiveState,
      confidence: state.confidence,
      acousticDb: state.acoustic?.overallDb ?? null,
      behavioralVector: state.behavioral
        ? [
            state.behavioral.typingSpeed,
            state.behavioral.errorRate,
            state.behavioral.interKeyLatency,
            state.behavioral.mouseJitter,
            state.behavioral.scrollVelocity,
            state.behavioral.focusSwitchRate,
          ]
        : null,
      timestamp: new Date(state.timestamp),
    });

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
