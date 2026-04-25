/**
 * InterventionAgent — runs in the browser (client-side).
 *
 * Given a goal mode (focus/calm/creative/social) and the current state
 * from PerceptionAgent, queries CorrelationAgent for the user's optimal
 * profile, computes the gap, and dispatches an EQ profile + bed selection.
 *
 * Writes results to:
 * - window.__residueIntervention (for Agent A's BedPlayer)
 * - MongoDB via API route
 *
 * Architecture role (Cognition pitch): The actuator agent that closes
 * the perception→action loop. Takes acoustic environment context and
 * translates it into concrete environmental interventions.
 */

import type {
  InterventionCommand,
  OptimalAcousticProfile,
  PerceptionState,
  AgentMessage,
} from '@/lib/types/agents';

/** Mode-specific EQ presets when no learned profile is available. */
const MODE_PRESETS: Record<string, { eqBias: number[]; preferredBed: string }> = {
  focus: {
    eqBias: [0.3, 0.4, 0.5, 0.3, 0.2, 0.1, 0.1],
    preferredBed: 'brown-noise',
  },
  calm: {
    eqBias: [0.5, 0.4, 0.3, 0.2, 0.1, 0.1, 0.05],
    preferredBed: 'rain',
  },
  creative: {
    eqBias: [0.2, 0.3, 0.4, 0.5, 0.4, 0.3, 0.2],
    preferredBed: 'cafe',
  },
  social: {
    eqBias: [0.1, 0.2, 0.3, 0.5, 0.5, 0.4, 0.3],
    preferredBed: 'white-noise',
  },
};

const BAND_LABELS = [
  'Sub-bass', 'Bass', 'Low-mid', 'Mid', 'Upper-mid', 'Presence', 'Brilliance',
];

export class InterventionAgent {
  private goalMode: 'focus' | 'calm' | 'creative' | 'social' = 'focus';
  private optimalProfile: OptimalAcousticProfile | null = null;

  setGoal(mode: 'focus' | 'calm' | 'creative' | 'social'): void {
    this.goalMode = mode;
  }

  setOptimalProfile(profile: OptimalAcousticProfile): void {
    this.optimalProfile = profile;
  }

  /**
   * Compute the intervention command based on current perception state.
   * Also publishes to window.__residueIntervention.
   */
  computeIntervention(perception: PerceptionState): InterventionCommand {
    const acoustic = perception.acoustic;
    const currentDb = acoustic?.overallDb ?? 40;

    // Use learned profile or fall back to mode preset
    const profile = this.optimalProfile;
    const preset = MODE_PRESETS[this.goalMode] ?? MODE_PRESETS.focus;

    const targetDb = profile?.targetDb ?? 50;
    const targetEq = profile?.eqGains ?? preset.eqBias;

    // Compute per-band gap analysis
    const currentBands = acoustic?.frequencyBands ?? [];
    const bands = BAND_LABELS.map((band, i) => {
      const current = currentBands[i]?.magnitude ?? 0;
      const target = targetEq[i] ?? 0;
      return { band, current, target, delta: target - current };
    });

    // Select the best bed based on profile + mode
    const bedSelection = this.selectBed(profile, preset);

    const command: InterventionCommand = {
      goalMode: this.goalMode,
      eqProfile: targetEq,
      bedSelection,
      bedUrl: null,
      volumeTarget: Math.max(0, Math.min(1, (targetDb - currentDb + 50) / 100)),
      gapAnalysis: {
        currentDb,
        targetDb,
        delta: targetDb - currentDb,
        bands,
      },
      timestamp: Date.now(),
    };

    // Publish for Agent A's BedPlayer
    if (typeof window !== 'undefined') {
      window.__residueIntervention = command;
    }

    return command;
  }

  private selectBed(
    profile: OptimalAcousticProfile | null,
    preset: { eqBias: number[]; preferredBed: string }
  ): string {
    if (!profile) return preset.preferredBed;

    // If profile emphasizes low frequencies → brown/pink noise
    // If mid frequencies → cafe/rain
    // If even distribution → white noise
    const gains = profile.eqGains;
    const lowEnergy = (gains[0] + gains[1] + gains[2]) / 3;
    const midEnergy = (gains[3] + gains[4]) / 2;
    const highEnergy = (gains[5] + gains[6]) / 2;

    if (lowEnergy > midEnergy && lowEnergy > highEnergy) return 'brown-noise';
    if (midEnergy > highEnergy) return 'cafe';
    return 'pink-noise';
  }

  buildMessage<T>(recipient: string, type: string, payload: T): AgentMessage<T> {
    return {
      sender: 'agent://residue/intervention',
      recipient,
      type,
      payload,
      timestamp: Date.now(),
    };
  }
}

let instance: InterventionAgent | null = null;

export function getInterventionAgent(): InterventionAgent {
  if (!instance) {
    instance = new InterventionAgent();
  }
  return instance;
}
