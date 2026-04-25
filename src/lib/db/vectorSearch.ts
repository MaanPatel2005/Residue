/**
 * MongoDB Atlas Vector Search for Residue.
 *
 * Uses the 7-band EQ gain vector as a 7-dimensional embedding for
 * vector similarity search. Enables "find my similar past moments"
 * — given the current acoustic features, find the 10 closest historical
 * sessions and return what state the user was in.
 *
 * Requires Atlas Vector Search index:
 *   {
 *     "type": "vectorSearch",
 *     "fields": [{
 *       "path": "acoustic_features.frequencyBands",
 *       "numDimensions": 7,
 *       "type": "vector",
 *       "similarity": "cosine"
 *     }]
 *   }
 */

import { getDb } from '@/lib/mongodb';

interface SimilarMoment {
  timestamp: Date;
  state: string;
  goal: string;
  productivityScore: number;
  acousticDb: number;
  frequencyBands: number[];
  similarity: number;
}

/**
 * Search for the most similar past acoustic moments using Atlas Vector Search.
 *
 * Falls back to a manual cosine similarity search if the Atlas vector
 * index is not configured (common in development).
 */
export async function findSimilarMoments(
  userId: string,
  currentEqVector: number[],
  limit: number = 10
): Promise<SimilarMoment[]> {
  const db = await getDb();
  const collection = db.collection('sessions_ts');

  // Try Atlas Vector Search first
  try {
    const pipeline = [
      {
        $vectorSearch: {
          index: 'acoustic_vector_index',
          path: 'acoustic_features.frequencyBands',
          queryVector: currentEqVector,
          numCandidates: limit * 10,
          limit,
          filter: { user_id: userId },
        },
      },
      {
        $project: {
          timestamp: 1,
          state: 1,
          goal: 1,
          productivity_score: 1,
          'acoustic_features.overallDb': 1,
          'acoustic_features.frequencyBands': 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ];

    const results = await collection.aggregate(pipeline).toArray();

    if (results.length > 0) {
      return results.map((r) => ({
        timestamp: r.timestamp as Date,
        state: r.state as string,
        goal: r.goal as string,
        productivityScore: r.productivity_score as number,
        acousticDb: (r.acoustic_features as { overallDb: number }).overallDb,
        frequencyBands: (r.acoustic_features as { frequencyBands: number[] }).frequencyBands,
        similarity: r.score as number,
      }));
    }
  } catch {
    // Atlas Vector Search not available, fall through to manual search
  }

  // Fallback: manual cosine similarity search
  return manualSimilaritySearch(userId, currentEqVector, limit);
}

/**
 * Manual cosine similarity search as fallback when Atlas Vector Search
 * is not configured. Loads recent sessions and computes similarity in JS.
 */
async function manualSimilaritySearch(
  userId: string,
  queryVector: number[],
  limit: number
): Promise<SimilarMoment[]> {
  const db = await getDb();
  const collection = db.collection('sessions_ts');

  const docs = await collection
    .find({ user_id: userId })
    .sort({ timestamp: -1 })
    .limit(500)
    .toArray();

  const scored: SimilarMoment[] = [];

  for (const doc of docs) {
    const features = doc.acoustic_features as { overallDb: number; frequencyBands: number[] } | undefined;
    if (!features?.frequencyBands) continue;

    const sim = cosineSimilarity(queryVector, features.frequencyBands);

    scored.push({
      timestamp: doc.timestamp as Date,
      state: doc.state as string,
      goal: doc.goal as string,
      productivityScore: doc.productivity_score as number,
      acousticDb: features.overallDb,
      frequencyBands: features.frequencyBands,
      similarity: sim,
    });
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Create the Atlas Vector Search index definition.
 * Returns the index definition as JSON for manual creation
 * (Atlas requires index creation through the UI or Atlas Admin API).
 */
export function getVectorIndexDefinition() {
  return {
    name: 'acoustic_vector_index',
    type: 'vectorSearch',
    definition: {
      fields: [
        {
          path: 'acoustic_features.frequencyBands',
          numDimensions: 7,
          type: 'vector',
          similarity: 'cosine',
        },
      ],
    },
  };
}

/**
 * Predict productivity for a given acoustic environment based on
 * similar past moments.
 */
export async function predictProductivity(
  userId: string,
  currentEqVector: number[]
): Promise<{
  predictedScore: number;
  confidence: number;
  similarMoments: number;
  dominantState: string;
}> {
  const moments = await findSimilarMoments(userId, currentEqVector, 10);

  if (moments.length === 0) {
    return {
      predictedScore: 50,
      confidence: 0,
      similarMoments: 0,
      dominantState: 'unknown',
    };
  }

  // Weighted average by similarity
  let weightedSum = 0;
  let weightTotal = 0;
  const stateCounts = new Map<string, number>();

  for (const m of moments) {
    weightedSum += m.productivityScore * m.similarity;
    weightTotal += m.similarity;

    const count = stateCounts.get(m.state) ?? 0;
    stateCounts.set(m.state, count + 1);
  }

  const predictedScore = weightTotal > 0 ? weightedSum / weightTotal : 50;

  // Find dominant state
  let dominantState = 'unknown';
  let maxCount = 0;
  for (const [state, count] of stateCounts) {
    if (count > maxCount) {
      maxCount = count;
      dominantState = state;
    }
  }

  const confidence = Math.min(moments.length / 10, 1) *
    (moments[0]?.similarity ?? 0);

  return {
    predictedScore: Math.round(predictedScore),
    confidence: Math.round(confidence * 100) / 100,
    similarMoments: moments.length,
    dominantState,
  };
}
