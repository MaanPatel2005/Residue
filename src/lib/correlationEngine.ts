import type {
  AcousticProfile,
  ProductivitySnapshot,
  AcousticStateCorrelation,
  UserProfile,
  FrequencyBand,
} from '@/types';

const DB_BUCKET_SIZE = 5;

export function createCorrelation(
  acoustic: AcousticProfile,
  productivity: ProductivitySnapshot,
  userId: string
): AcousticStateCorrelation {
  return {
    id: `corr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId,
    acousticProfile: acoustic,
    productivitySnapshot: productivity,
    createdAt: Date.now(),
  };
}

export function analyzeCorrelations(
  correlations: AcousticStateCorrelation[]
): UserProfile | null {
  if (correlations.length < 3) return null;

  const dbBuckets = new Map<number, { totalProductivity: number; count: number }>();

  for (const corr of correlations) {
    const bucket = Math.round(corr.acousticProfile.overallDb / DB_BUCKET_SIZE) * DB_BUCKET_SIZE;
    const existing = dbBuckets.get(bucket) || { totalProductivity: 0, count: 0 };
    existing.totalProductivity += corr.productivitySnapshot.productivityScore;
    existing.count++;
    dbBuckets.set(bucket, existing);
  }

  const productivityByEnvironment = Array.from(dbBuckets.entries())
    .map(([dbLevel, data]) => ({
      dbLevel,
      avgProductivity: Math.round(data.totalProductivity / data.count),
      sampleCount: data.count,
    }))
    .sort((a, b) => a.dbLevel - b.dbLevel);

  let bestDb = 50;
  let bestProductivity = 0;
  for (const env of productivityByEnvironment) {
    if (env.avgProductivity > bestProductivity) {
      bestProductivity = env.avgProductivity;
      bestDb = env.dbLevel;
    }
  }

  const optimalDbRange: [number, number] = [
    Math.max(0, bestDb - DB_BUCKET_SIZE),
    bestDb + DB_BUCKET_SIZE,
  ];

  const frequencyAccum = new Map<string, { totalMag: number; count: number }>();
  const bestCorrelations = correlations
    .filter((c) => c.productivitySnapshot.productivityScore >= 60)
    .slice(-20);

  for (const corr of bestCorrelations) {
    for (const band of corr.acousticProfile.frequencyBands) {
      const existing = frequencyAccum.get(band.label) || { totalMag: 0, count: 0 };
      existing.totalMag += band.magnitude;
      existing.count++;
      frequencyAccum.set(band.label, existing);
    }
  }

  const optimalFrequencyProfile: FrequencyBand[] = Array.from(frequencyAccum.entries()).map(
    ([label, data]) => ({
      label,
      range: [0, 0] as [number, number],
      magnitude: data.count > 0 ? data.totalMag / data.count : 0,
    })
  );

  return {
    id: `profile-${correlations[0]?.userId || 'anon'}`,
    optimalDbRange,
    optimalFrequencyProfile,
    productivityByEnvironment,
    totalSessions: correlations.length,
    createdAt: correlations[0]?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
}

export function getRecommendation(
  profile: UserProfile,
  currentAcoustic: AcousticProfile
): {
  action: string;
  targetDb: number;
  message: string;
  confidence: number;
} {
  const currentDb = currentAcoustic.overallDb;
  const [optLow, optHigh] = profile.optimalDbRange;
  const targetDb = (optLow + optHigh) / 2;

  const confidence = Math.min(profile.totalSessions / 20, 1);

  if (currentDb < optLow) {
    return {
      action: 'increase',
      targetDb,
      message: `Your environment is quieter than your optimal range (${optLow}-${optHigh}dB). Adding ambient sound to boost focus.`,
      confidence,
    };
  } else if (currentDb > optHigh) {
    return {
      action: 'decrease',
      targetDb,
      message: `Your environment is louder than your optimal range (${optLow}-${optHigh}dB). Consider noise cancellation or moving.`,
      confidence,
    };
  }

  return {
    action: 'maintain',
    targetDb,
    message: `You're in your optimal acoustic zone (${optLow}-${optHigh}dB). Keep it up!`,
    confidence,
  };
}
