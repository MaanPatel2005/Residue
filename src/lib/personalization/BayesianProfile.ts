/**
 * BayesianProfile — Bayesian posterior update engine for personalized
 * acoustic profile learning.
 *
 * Each new data point updates a posterior over the user's optimal acoustic
 * profile. Shows confidence intervals in the UI. Controls for confounders:
 * time of day, day of week, task type.
 *
 * Why Bayesian: A judge with an ML background will ask about overfitting
 * on small samples. The Bayesian approach gives a principled answer:
 * the posterior naturally shrinks uncertainty as data accumulates,
 * and the prior prevents extreme estimates from few observations.
 */

import type {
  BayesianProfile,
  ProfilePosterior,
  ProfileConfidence,
  GaussianDistribution,
  ProductivityCurvePoint,
  ConfounderState,
  TimeOfDayEffect,
  DayOfWeekEffect,
  TaskTypeEffect,
} from '@/lib/types/profile';
import type { AcousticStateCorrelation } from '@/types';

// ── Prior hyperparameters ───────────────────────────────────────────────────

const PRIOR_DB_MEAN = 50;       // uninformative prior: 50 dB
const PRIOR_DB_VARIANCE = 400;  // wide prior: σ² = 400 → σ ≈ 20 dB
const PRIOR_EQ_MEAN = 0.3;     // moderate gain prior
const PRIOR_EQ_VARIANCE = 0.1; // moderate uncertainty
const NUM_EQ_BANDS = 7;

const Z_95 = 1.96; // 95% confidence interval z-score

/**
 * Create an initial (prior) Bayesian profile for a new user.
 */
export function createPriorProfile(userId: string): BayesianProfile {
  const eqGains: GaussianDistribution[] = Array.from({ length: NUM_EQ_BANDS }, () => ({
    mean: PRIOR_EQ_MEAN,
    variance: PRIOR_EQ_VARIANCE,
    n: 0,
  }));

  return {
    userId,
    posterior: {
      optimalDb: { mean: PRIOR_DB_MEAN, variance: PRIOR_DB_VARIANCE, n: 0 },
      eqGains,
      productivityCurve: [],
    },
    confidence: computeConfidence(
      { mean: PRIOR_DB_MEAN, variance: PRIOR_DB_VARIANCE, n: 0 },
      eqGains
    ),
    totalObservations: 0,
    confounders: {
      timeOfDay: [],
      dayOfWeek: [],
      taskType: [],
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Update the Bayesian profile with a new observation.
 *
 * Uses conjugate Gaussian updates:
 *   posterior mean = (prior_precision * prior_mean + obs_precision * obs) / total_precision
 *   posterior variance = 1 / total_precision
 *
 * where precision = 1 / variance.
 */
export function updateProfile(
  profile: BayesianProfile,
  correlation: AcousticStateCorrelation,
  taskType?: string
): BayesianProfile {
  const db = correlation.acousticProfile.overallDb;
  const productivity = correlation.productivitySnapshot.productivityScore;
  const bands = correlation.acousticProfile.frequencyBands;
  const timestamp = new Date(correlation.createdAt);

  // Update optimal dB posterior (weighted by productivity)
  const weight = productivity / 100; // higher productivity = stronger signal
  const observationVariance = 100 / (weight + 0.1); // lower variance for high-productivity obs
  const updatedDb = gaussianUpdate(
    profile.posterior.optimalDb,
    db,
    observationVariance
  );

  // Update per-band EQ posteriors
  const updatedEqGains = profile.posterior.eqGains.map((prior, i) => {
    const bandMag = bands[i]?.magnitude ?? PRIOR_EQ_MEAN;
    return gaussianUpdate(prior, bandMag, PRIOR_EQ_VARIANCE * 2 / (weight + 0.1));
  });

  // Update productivity curve
  const updatedCurve = updateProductivityCurve(
    profile.posterior.productivityCurve,
    db,
    productivity
  );

  // Update confounders
  const updatedConfounders = updateConfounders(
    profile.confounders,
    timestamp,
    db,
    productivity,
    taskType
  );

  const posterior: ProfilePosterior = {
    optimalDb: updatedDb,
    eqGains: updatedEqGains,
    productivityCurve: updatedCurve,
  };

  return {
    ...profile,
    posterior,
    confidence: computeConfidence(updatedDb, updatedEqGains),
    totalObservations: profile.totalObservations + 1,
    confounders: updatedConfounders,
    updatedAt: Date.now(),
  };
}

/**
 * Conjugate Gaussian posterior update.
 */
function gaussianUpdate(
  prior: GaussianDistribution,
  observation: number,
  observationVariance: number
): GaussianDistribution {
  const priorPrecision = 1 / prior.variance;
  const obsPrecision = 1 / observationVariance;
  const totalPrecision = priorPrecision + obsPrecision;

  const posteriorMean =
    (priorPrecision * prior.mean + obsPrecision * observation) / totalPrecision;
  const posteriorVariance = 1 / totalPrecision;

  return {
    mean: posteriorMean,
    variance: posteriorVariance,
    n: prior.n + 1,
  };
}

/**
 * Update the productivity-by-dB curve.
 */
function updateProductivityCurve(
  curve: ProductivityCurvePoint[],
  db: number,
  productivity: number
): ProductivityCurvePoint[] {
  const bucketSize = 5;
  const bucket = Math.round(db / bucketSize) * bucketSize;

  const updated = [...curve];
  const existingIdx = updated.findIndex((p) => p.db === bucket);

  if (existingIdx >= 0) {
    const existing = updated[existingIdx];
    const newN = existing.n + 1;
    const newMean =
      (existing.expectedProductivity * existing.n + productivity) / newN;
    const newVariance =
      existing.n > 0
        ? ((existing.variance * (existing.n - 1) +
            (productivity - existing.expectedProductivity) *
              (productivity - newMean)) /
            newN)
        : 0;

    updated[existingIdx] = {
      db: bucket,
      expectedProductivity: newMean,
      variance: Math.max(newVariance, 1),
      n: newN,
    };
  } else {
    updated.push({
      db: bucket,
      expectedProductivity: productivity,
      variance: 100,
      n: 1,
    });
  }

  return updated.sort((a, b) => a.db - b.db);
}

/**
 * Update confounder tracking.
 */
function updateConfounders(
  confounders: ConfounderState,
  timestamp: Date,
  db: number,
  productivity: number,
  taskType?: string
): ConfounderState {
  const hour = timestamp.getHours();
  const day = timestamp.getDay();

  // Time of day effect
  const timeEffects = updateEffect(
    confounders.timeOfDay,
    hour,
    db,
    productivity,
    'hour'
  ) as TimeOfDayEffect[];

  // Day of week effect
  const dayEffects = updateEffect(
    confounders.dayOfWeek,
    day,
    db,
    productivity,
    'day'
  ) as DayOfWeekEffect[];

  // Task type effect
  let taskEffects = confounders.taskType;
  if (taskType) {
    const existing = taskEffects.find((t) => t.taskType === taskType);
    if (existing) {
      const newN = existing.n + 1;
      taskEffects = taskEffects.map((t) =>
        t.taskType === taskType
          ? {
              ...t,
              dbOffset: (t.dbOffset * t.n + (db - PRIOR_DB_MEAN)) / newN,
              productivityMod: (t.productivityMod * t.n + productivity / 50) / newN,
              n: newN,
            }
          : t
      );
    } else {
      taskEffects = [
        ...taskEffects,
        {
          taskType,
          dbOffset: db - PRIOR_DB_MEAN,
          productivityMod: productivity / 50,
          n: 1,
        },
      ];
    }
  }

  return {
    timeOfDay: timeEffects,
    dayOfWeek: dayEffects,
    taskType: taskEffects,
  };
}

function updateEffect<T extends { n: number; dbOffset: number; productivityMod: number }>(
  effects: T[],
  key: number,
  db: number,
  productivity: number,
  keyField: string
): T[] {
  const existing = effects.find((e) => (e as Record<string, unknown>)[keyField] === key);

  if (existing) {
    const newN = existing.n + 1;
    return effects.map((e) =>
      (e as Record<string, unknown>)[keyField] === key
        ? ({
            ...e,
            dbOffset: (e.dbOffset * e.n + (db - PRIOR_DB_MEAN)) / newN,
            productivityMod: (e.productivityMod * e.n + productivity / 50) / newN,
            n: newN,
          } as T)
        : e
    );
  }

  return [
    ...effects,
    {
      [keyField]: key,
      dbOffset: db - PRIOR_DB_MEAN,
      productivityMod: productivity / 50,
      n: 1,
    } as T,
  ];
}

/**
 * Compute confidence metrics from the posterior.
 */
function computeConfidence(
  dbPosterior: GaussianDistribution,
  eqPosteriors: GaussianDistribution[]
): ProfileConfidence {
  const dbStd = Math.sqrt(dbPosterior.variance);
  const intervalLow = dbPosterior.mean - Z_95 * dbStd;
  const intervalHigh = dbPosterior.mean + Z_95 * dbStd;

  // DB estimate confidence: narrows as variance decreases
  const dbConfidence = Math.min(
    1,
    PRIOR_DB_VARIANCE / (dbPosterior.variance + PRIOR_DB_VARIANCE) * 2
  );

  // EQ confidence: average of band confidences
  const eqConfidence =
    eqPosteriors.reduce((sum, g) => {
      return sum + Math.min(1, PRIOR_EQ_VARIANCE / (g.variance + PRIOR_EQ_VARIANCE) * 2);
    }, 0) / eqPosteriors.length;

  const overall = (dbConfidence * 0.6 + eqConfidence * 0.4);

  // Estimate sessions needed for 80% confidence
  const currentN = dbPosterior.n;
  const targetVariance = PRIOR_DB_VARIANCE * 0.1; // 10% of prior variance = high confidence
  const sessionsNeeded = Math.max(
    0,
    Math.ceil((PRIOR_DB_VARIANCE / targetVariance - 1) - currentN)
  );

  return {
    overall: Math.round(overall * 100) / 100,
    dbEstimate: Math.round(dbConfidence * 100) / 100,
    eqEstimate: Math.round(eqConfidence * 100) / 100,
    intervalLow: Math.round(intervalLow),
    intervalHigh: Math.round(intervalHigh),
    sessionsNeeded: Math.max(0, sessionsNeeded),
  };
}

/**
 * Build a batch profile from a set of correlations (for initial profile
 * construction from historical data).
 */
export function buildProfileFromCorrelations(
  userId: string,
  correlations: AcousticStateCorrelation[]
): BayesianProfile {
  let profile = createPriorProfile(userId);

  for (const c of correlations) {
    profile = updateProfile(profile, c);
  }

  return profile;
}
