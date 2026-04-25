import { NextResponse } from 'next/server';
import { buildPromptVariations } from '@/lib/elevenlabs/PromptBuilder';
import { generateSfx } from '@/lib/elevenlabs/SfxClient';
import { cacheBed, getActiveBedUrl, buildFingerprint, needsRegeneration, getCachedBeds } from '@/lib/elevenlabs/BedCache';
import type { OptimalAcousticProfile } from '@/lib/types/agents';
import type { BedDocument } from '@/lib/types/profile';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

/**
 * POST /api/beds/generate
 * Generate personalized ambient beds using ElevenLabs Sound Effects API.
 *
 * Body: {
 *   userId: string,
 *   profile: OptimalAcousticProfile,
 *   mode: "focus" | "calm" | "creative" | "social",
 *   count?: number  // default 5
 * }
 *
 * Returns cached beds if the profile hasn't changed materially.
 * Otherwise generates new beds and caches them.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, profile, mode = 'focus', count = 5 } = body as {
      userId: string;
      profile: OptimalAcousticProfile;
      mode: string;
      count?: number;
    };

    if (!userId || !profile) {
      return NextResponse.json(
        { error: 'userId and profile required' },
        { status: 400 }
      );
    }

    // Check if we have a valid cached bed
    try {
      const cachedUrl = await getActiveBedUrl(userId, mode, profile);
      if (cachedUrl) {
        return NextResponse.json({
          status: 'cached',
          bedUrl: cachedUrl,
          message: 'Using cached bed (profile unchanged)',
        });
      }
    } catch {
      // MongoDB not available, proceed with generation
    }

    // Check for API key
    const apiKey = process.env.ELEVENLABS_API_KEY || process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY;
    if (!apiKey) {
      // Return sample prompts without generating (for demo without API key)
      const prompts = buildPromptVariations(profile, mode, count);
      return NextResponse.json({
        status: 'no_api_key',
        message: 'ELEVENLABS_API_KEY not set. Here are the prompts that would be sent:',
        prompts,
        samplePrompt: prompts[0],
      });
    }

    // Generate beds
    const prompts = buildPromptVariations(profile, mode, count);
    const results: BedDocument[] = [];
    const errors: string[] = [];

    // Ensure public/beds directory exists
    const bedsDir = join(process.cwd(), 'public', 'beds');
    try {
      await mkdir(bedsDir, { recursive: true });
    } catch {
      // directory may already exist
    }

    for (let i = 0; i < prompts.length; i++) {
      try {
        const result = await generateSfx({ prompt: prompts[i] }, apiKey);

        // Save to public/beds/ for static serving
        const filename = `${userId}-${mode}-${Date.now()}-${i}.mp3`;
        const filepath = join(bedsDir, filename);
        await writeFile(filepath, Buffer.from(result.audioData));

        const url = `/beds/${filename}`;
        const fingerprint = buildFingerprint(profile, mode);

        const bedDoc: BedDocument = {
          userId,
          prompt: prompts[i],
          profileFingerprint: JSON.stringify(fingerprint),
          eqVector: profile.eqGains,
          url,
          generatedAt: result.generatedAt,
          durationSeconds: result.durationSeconds,
          mode,
        };

        // Cache in MongoDB
        try {
          await cacheBed(bedDoc);
        } catch {
          // MongoDB not available, bed still saved to public/
        }

        results.push(bedDoc);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Prompt ${i}: ${message}`);
      }
    }

    return NextResponse.json({
      status: results.length > 0 ? 'generated' : 'failed',
      beds: results,
      errors,
      prompts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/beds/generate?userId=xxx&mode=focus
 * Returns cached beds for a user.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    try {
      const beds = await getCachedBeds(userId);
      return NextResponse.json({ status: 'ok', beds });
    } catch {
      return NextResponse.json({ status: 'no_db', beds: [] });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
