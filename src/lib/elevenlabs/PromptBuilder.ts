/**
 * PromptBuilder — converts a learned acoustic profile into a natural-language
 * SFX prompt for the ElevenLabs Sound Effects API.
 *
 * The prompt captures the user's optimal frequency profile, target dB range,
 * and mode preferences to generate a personalized ambient bed.
 */

import type { OptimalAcousticProfile } from '@/lib/types/agents';

const BAND_LABELS = [
  'Sub-bass', 'Bass', 'Low-mid', 'Mid', 'Upper-mid', 'Presence', 'Brilliance',
];

const BAND_DESCRIPTORS: Record<string, { low: string; high: string; freq: string }> = {
  'Sub-bass':   { low: 'minimal sub-bass rumble', high: 'deep sub-bass warmth', freq: '20-60Hz' },
  'Bass':       { low: 'light bass presence', high: 'rich bass foundation', freq: '60-250Hz' },
  'Low-mid':    { low: 'thin low-mid texture', high: 'warm 200Hz body', freq: '250-500Hz' },
  'Mid':        { low: 'recessed midrange', high: 'full midrange presence', freq: '500-2kHz' },
  'Upper-mid':  { low: 'soft upper-mid', high: 'articulate upper harmonics', freq: '2-4kHz' },
  'Presence':   { low: 'subdued presence', high: 'crisp high-frequency detail', freq: '4-6kHz' },
  'Brilliance': { low: 'no air or sparkle', high: 'airy high-frequency shimmer', freq: '6-20kHz' },
};

const MODE_TEXTURES: Record<string, string> = {
  focus: 'steady, non-distracting, constant texture, no rhythmic variation',
  calm: 'gentle, slowly evolving, organic, breathing quality',
  creative: 'subtle variation, occasional sparse textures, slightly dynamic',
  social: 'warm, inviting, light ambient murmur',
};

const MODE_ENVIRONMENTS: Record<string, string> = {
  focus: 'library-like stillness with distant HVAC hum',
  calm: 'quiet nature, gentle wind through trees',
  creative: 'distant café murmur with occasional soft clicks',
  social: 'warm coffee shop ambience, light background chatter',
};

/**
 * Build a natural-language SFX prompt from a learned profile.
 *
 * Examples:
 *   profile { dB: 52, dominant_band: "low-mid", bass_tolerance: low }
 *   → "Warm 200Hz pink noise with sparse high-frequency texture,
 *      no music, distant café murmur, seamless loop."
 */
export function buildPrompt(
  profile: OptimalAcousticProfile,
  mode: string = 'focus'
): string {
  const gains = profile.eqGains;
  const targetDb = profile.targetDb;

  // Describe the frequency character
  const bandDescriptions: string[] = [];
  for (let i = 0; i < Math.min(gains.length, BAND_LABELS.length); i++) {
    const label = BAND_LABELS[i];
    const gain = gains[i];
    const desc = BAND_DESCRIPTORS[label];
    if (!desc) continue;

    if (gain > 0.5) {
      bandDescriptions.push(desc.high);
    } else if (gain > 0.3) {
      // moderate — don't mention
    } else {
      bandDescriptions.push(desc.low);
    }
  }

  // Determine dominant character
  const lowEnergy = ((gains[0] ?? 0) + (gains[1] ?? 0) + (gains[2] ?? 0)) / 3;
  const midEnergy = ((gains[3] ?? 0) + (gains[4] ?? 0)) / 2;
  const highEnergy = ((gains[5] ?? 0) + (gains[6] ?? 0)) / 2;

  let noiseType = 'pink noise';
  if (lowEnergy > midEnergy && lowEnergy > highEnergy) noiseType = 'brown noise';
  else if (highEnergy > lowEnergy) noiseType = 'white noise';

  // Volume descriptor
  let volumeDesc = 'moderate volume';
  if (targetDb < 35) volumeDesc = 'very quiet, barely perceptible';
  else if (targetDb < 45) volumeDesc = 'quiet, gentle';
  else if (targetDb < 55) volumeDesc = 'moderate ambient level';
  else if (targetDb < 65) volumeDesc = 'noticeable ambient presence';
  else volumeDesc = 'full ambient volume';

  const texture = MODE_TEXTURES[mode] ?? MODE_TEXTURES.focus;
  const environment = MODE_ENVIRONMENTS[mode] ?? MODE_ENVIRONMENTS.focus;

  const freqDesc = bandDescriptions.length > 0
    ? bandDescriptions.slice(0, 3).join(', ')
    : 'balanced frequency spectrum';

  return [
    `${noiseType} ambient soundscape at ${volumeDesc} (~${targetDb}dB equivalent).`,
    `Frequency character: ${freqDesc}.`,
    `Environment: ${environment}.`,
    `Texture: ${texture}.`,
    'No music, no speech, no sudden changes.',
    'Seamless loop, 30 seconds duration.',
  ].join(' ');
}

/**
 * Generate multiple prompt variations for a profile.
 * Returns 5 prompts with slight variations for diversity.
 */
export function buildPromptVariations(
  profile: OptimalAcousticProfile,
  mode: string = 'focus',
  count: number = 5
): string[] {
  const base = buildPrompt(profile, mode);
  const variations: string[] = [base];

  const suffixes = [
    'With occasional distant rain drops.',
    'With subtle wind texture.',
    'With very faint room tone resonance.',
    'With gentle low-frequency oscillation.',
    'With sparse, high-pitched ambient sparkle.',
    'With distant water stream texture.',
    'With soft mechanical hum undertone.',
  ];

  for (let i = 1; i < count && i <= suffixes.length; i++) {
    variations.push(`${base} ${suffixes[i - 1]}`);
  }

  return variations.slice(0, count);
}
