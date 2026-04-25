import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { targetDb, currentDb, mode, frequencyProfile } = body;

  const recommendation = generateAcousticRecommendation(
    targetDb,
    currentDb,
    mode,
    frequencyProfile
  );

  return NextResponse.json(recommendation);
}

function generateAcousticRecommendation(
  targetDb: number,
  currentDb: number,
  mode: string,
  frequencyProfile?: { label: string; magnitude: number }[]
) {
  const dbDiff = targetDb - currentDb;

  const modePresets: Record<string, {
    preferredSounds: string[];
    frequencyEmphasis: string;
    volumeMultiplier: number;
  }> = {
    focus: {
      preferredSounds: ['brown-noise', 'rain', 'binaural'],
      frequencyEmphasis: 'low-mid',
      volumeMultiplier: 0.6,
    },
    calm: {
      preferredSounds: ['pink-noise', 'rain'],
      frequencyEmphasis: 'sub-bass',
      volumeMultiplier: 0.4,
    },
    creative: {
      preferredSounds: ['cafe', 'pink-noise'],
      frequencyEmphasis: 'mid',
      volumeMultiplier: 0.7,
    },
    social: {
      preferredSounds: ['white-noise', 'cafe'],
      frequencyEmphasis: 'presence',
      volumeMultiplier: 0.5,
    },
  };

  const preset = modePresets[mode] || modePresets.focus;
  const suggestedVolume = Math.max(
    0.1,
    Math.min(1, (Math.abs(dbDiff) / 40) * preset.volumeMultiplier)
  );

  return {
    suggestedSound: preset.preferredSounds[0],
    suggestedVolume,
    action: dbDiff > 5 ? 'add-sound' : dbDiff < -5 ? 'reduce-sound' : 'maintain',
    targetDb,
    currentDb,
    message:
      dbDiff > 5
        ? `Adding ${preset.preferredSounds[0]} to bring environment closer to your optimal ${targetDb}dB`
        : dbDiff < -5
        ? `Your environment is louder than optimal. Consider noise reduction.`
        : `Environment is near your optimal level. Maintaining current state.`,
    frequencyAdjustments: frequencyProfile
      ? frequencyProfile.map((f) => ({
          band: f.label,
          currentMagnitude: f.magnitude,
          suggestedChange:
            f.label.toLowerCase() === preset.frequencyEmphasis ? 'boost' : 'neutral',
        }))
      : [],
  };
}
