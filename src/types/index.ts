export interface FrequencyBand {
  label: string;
  range: [number, number];
  magnitude: number;
}

export interface AcousticProfile {
  timestamp: number;
  overallDb: number;
  frequencyBands: FrequencyBand[];
  dominantFrequency: number;
  spectralCentroid: number;
}

export interface ProductivitySnapshot {
  timestamp: number;
  screenChanged: boolean;
  changePercentage: number;
  productivityScore: number; // 0-100
  selfReport?: number; // 1-5
}

export interface AcousticStateCorrelation {
  id: string;
  userId: string;
  acousticProfile: AcousticProfile;
  productivitySnapshot: ProductivitySnapshot;
  createdAt: number;
}

export interface UserProfile {
  id: string;
  optimalDbRange: [number, number];
  optimalFrequencyProfile: FrequencyBand[];
  productivityByEnvironment: {
    dbLevel: number;
    avgProductivity: number;
    sampleCount: number;
  }[];
  totalSessions: number;
  createdAt: number;
  updatedAt: number;
}

export interface SessionState {
  isListening: boolean;
  isTracking: boolean;
  currentMode: 'focus' | 'calm' | 'creative' | 'social';
  currentAcoustic: AcousticProfile | null;
  currentProductivity: ProductivitySnapshot | null;
  audioOverlayActive: boolean;
  sessionStartTime: number | null;
  correlations: AcousticStateCorrelation[];
}

export interface StudyBuddy {
  id: string;
  name: string;
  optimalDbRange: [number, number];
  similarity: number; // 0-1
  currentlyStudying: boolean;
  location?: string;
}
