/**
 * SfxClient — ElevenLabs Sound Effects API integration.
 *
 * Uses the eleven_text_to_sound_v2 endpoint to generate personalized
 * ambient beds from natural-language prompts derived from the user's
 * learned acoustic profile.
 *
 * API: POST https://api.elevenlabs.io/v1/sound-generation
 *   - text: the SFX prompt
 *   - duration_seconds: 30
 *   - prompt_influence: 0.5
 */

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/sound-generation';

export interface SfxGenerationRequest {
  prompt: string;
  durationSeconds?: number;
  promptInfluence?: number;
}

export interface SfxGenerationResult {
  audioData: ArrayBuffer;
  prompt: string;
  durationSeconds: number;
  generatedAt: number;
}

/**
 * Generate a sound effect using the ElevenLabs Sound Effects API.
 * Returns the raw audio data (MP3) on success.
 */
export async function generateSfx(
  request: SfxGenerationRequest,
  apiKey?: string
): Promise<SfxGenerationResult> {
  const key = apiKey ?? process.env.ELEVENLABS_API_KEY ?? process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY;
  if (!key) {
    throw new Error(
      'ELEVENLABS_API_KEY is required. Set it in .env.local or pass it as a parameter.'
    );
  }

  const duration = request.durationSeconds ?? 30;

  const response = await fetch(ELEVENLABS_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': key,
    },
    body: JSON.stringify({
      text: request.prompt,
      duration_seconds: duration,
      prompt_influence: request.promptInfluence ?? 0.5,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs API error (${response.status}): ${errorText}`);
  }

  const audioData = await response.arrayBuffer();

  return {
    audioData,
    prompt: request.prompt,
    durationSeconds: duration,
    generatedAt: Date.now(),
  };
}

/**
 * Generate multiple beds in sequence. Returns results for each prompt.
 * Stops on first error and returns partial results.
 */
export async function generateBedBatch(
  prompts: string[],
  apiKey?: string
): Promise<{ results: SfxGenerationResult[]; errors: string[] }> {
  const results: SfxGenerationResult[] = [];
  const errors: string[] = [];

  for (const prompt of prompts) {
    try {
      const result = await generateSfx({ prompt }, apiKey);
      results.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Failed: ${message}`);
    }
  }

  return { results, errors };
}
