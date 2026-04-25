import { NextRequest, NextResponse } from 'next/server';
import { findSimilarMoments, predictProductivity } from '@/lib/db/vectorSearch';

/**
 * POST /api/similar-moments
 * Find similar past acoustic moments using Atlas Vector Search.
 *
 * Body: {
 *   userId: string,
 *   frequencyBands: number[]  // 7-dim EQ vector
 * }
 *
 * Returns the 10 most similar historical sessions and a productivity prediction.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, frequencyBands } = body as {
      userId: string;
      frequencyBands: number[];
    };

    if (!userId || !frequencyBands || frequencyBands.length !== 7) {
      return NextResponse.json(
        { error: 'userId and frequencyBands (7-dim array) required' },
        { status: 400 }
      );
    }

    const [moments, prediction] = await Promise.all([
      findSimilarMoments(userId, frequencyBands, 10),
      predictProductivity(userId, frequencyBands),
    ]);

    return NextResponse.json({
      status: 'ok',
      similarMoments: moments,
      prediction,
      vectorDimensions: 7,
      searchMethod: moments.length > 0 ? 'atlas_vector_search_or_fallback' : 'no_data',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
