// ── Bayesian Profile Types ──────────────────────────────────────────────────

export interface BayesianProfile {
  userId: string;
  posterior: ProfilePosterior;
  confidence: ProfileConfidence;
  totalObservations: number;
  confounders: ConfounderState;
  createdAt: number;
  updatedAt: number;
}

export interface ProfilePosterior {
  optimalDb: GaussianDistribution;
  eqGains: GaussianDistribution[];  // per-band posterior
  productivityCurve: ProductivityCurvePoint[];
}

export interface GaussianDistribution {
  mean: number;
  variance: number;
  n: number;  // sample count contributing
}

export interface ProductivityCurvePoint {
  db: number;
  expectedProductivity: number;
  variance: number;
  n: number;
}

export interface ProfileConfidence {
  overall: number;        // 0-1
  dbEstimate: number;     // 0-1
  eqEstimate: number;     // 0-1
  intervalLow: number;    // lower bound of 95% CI for optimal dB
  intervalHigh: number;   // upper bound of 95% CI for optimal dB
  sessionsNeeded: number; // estimated sessions until confidence > 0.8
}

export interface ConfounderState {
  timeOfDay: TimeOfDayEffect[];
  dayOfWeek: DayOfWeekEffect[];
  taskType: TaskTypeEffect[];
}

export interface TimeOfDayEffect {
  hour: number;          // 0-23
  dbOffset: number;      // shift in optimal dB for this hour
  productivityMod: number; // multiplier
  n: number;
}

export interface DayOfWeekEffect {
  day: number;           // 0=Sunday, 6=Saturday
  dbOffset: number;
  productivityMod: number;
  n: number;
}

export interface TaskTypeEffect {
  taskType: string;      // inferred from window title / active app
  dbOffset: number;
  productivityMod: number;
  n: number;
}

// ── Session Document (MongoDB time-series) ──────────────────────────────────

export interface SessionDocument {
  user_id: string;
  timestamp: Date;
  acoustic_features: {
    overallDb: number;
    frequencyBands: number[];  // 7-band magnitudes
    dominantFrequency: number;
    spectralCentroid: number;
  };
  behavioral_features: {
    typingSpeed: number;
    errorRate: number;
    interKeyLatency: number;
    mouseJitter: number;
    scrollVelocity: number;
    focusSwitchRate: number;
  };
  state: string;
  goal: string;
  active_bed_id: string | null;
  productivity_score: number;
  self_report: number | null;
}

// ── Bed Cache Types ─────────────────────────────────────────────────────────

export interface BedDocument {
  userId: string;
  prompt: string;
  profileFingerprint: string;
  eqVector: number[];
  url: string;
  generatedAt: number;
  durationSeconds: number;
  mode: string;
}

export interface ProfileFingerprint {
  eqVector: number[];
  targetDb: number;
  mode: string;
}
