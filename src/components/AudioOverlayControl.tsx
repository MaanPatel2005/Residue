'use client';

interface OverlayState {
  isPlaying: boolean;
  soundType: string;
  volume: number;
  targetDb: number;
  aiGenerating?: boolean;
  aiPrompt?: string | null;
}

interface Props {
  overlayState: OverlayState;
  onStart: (soundType: string, volume: number, targetDb: number) => void;
  onStop: () => void;
  onSetVolume: (volume: number) => void;
  onGenerateAiBed?: (mode: string) => void;
  currentMode?: string;
  recommendation?: {
    action: string;
    targetDb: number;
    message: string;
    confidence: number;
  } | null;
}

const SOUND_TYPES = [
  { id: 'brown-noise', label: 'Brown Noise', desc: 'Deep, warm rumble' },
  { id: 'pink-noise', label: 'Pink Noise', desc: 'Balanced, natural' },
  { id: 'white-noise', label: 'White Noise', desc: 'Even frequency spread' },
  { id: 'rain', label: 'Rain', desc: 'Gentle rainfall' },
  { id: 'cafe', label: 'Cafe', desc: 'Coffee shop ambience' },
  { id: 'binaural', label: 'Binaural', desc: 'Alpha wave focus' },
];

export default function AudioOverlayControl({
  overlayState,
  onStart,
  onStop,
  onSetVolume,
  onGenerateAiBed,
  currentMode = 'focus',
  recommendation,
}: Props) {
  return (
    <div className="bg-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-800 p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-white">Acoustic Overlay</h3>
        <div className="flex items-center gap-2">
          {overlayState.isPlaying && (
            <span className="flex items-center gap-1.5 text-xs text-green-400">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              Playing
            </span>
          )}
        </div>
      </div>

      {recommendation && (
        <div
          className={`rounded-lg p-3 text-sm ${
            recommendation.action === 'maintain'
              ? 'bg-green-500/10 border border-green-500/30 text-green-300'
              : recommendation.action === 'increase'
              ? 'bg-blue-500/10 border border-blue-500/30 text-blue-300'
              : 'bg-orange-500/10 border border-orange-500/30 text-orange-300'
          }`}
        >
          <p className="font-medium mb-1">
            AI Recommendation
            <span className="ml-2 text-xs opacity-60">
              ({Math.round(recommendation.confidence * 100)}% confidence)
            </span>
          </p>
          <p className="text-xs opacity-80">{recommendation.message}</p>
        </div>
      )}

      {/* ElevenLabs AI-Generated Bed */}
      <div className="space-y-2">
        <button
          onClick={() => {
            if (overlayState.isPlaying && overlayState.soundType === 'ai-generated') {
              onStop();
            } else if (onGenerateAiBed) {
              onGenerateAiBed(currentMode);
            }
          }}
          disabled={overlayState.aiGenerating}
          className={`w-full p-3 rounded-lg text-left transition-all ${
            overlayState.isPlaying && overlayState.soundType === 'ai-generated'
              ? 'bg-purple-500/20 border border-purple-500/50 ring-1 ring-purple-500/30'
              : overlayState.aiGenerating
              ? 'bg-gray-800/50 border border-gray-700 opacity-70 cursor-wait'
              : 'bg-linear-to-r from-purple-500/10 to-cyan-500/10 border border-purple-500/30 hover:border-purple-500/50'
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white flex items-center gap-2">
                <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                AI Personalized Bed
                <span className="text-[10px] px-1.5 py-0.5 bg-purple-500/20 text-purple-300 rounded">ElevenLabs</span>
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {overlayState.aiGenerating
                  ? 'Generating personalized soundscape...'
                  : 'Generated from your learned acoustic profile'}
              </p>
            </div>
            {overlayState.aiGenerating && (
              <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
            )}
          </div>
        </button>

        {overlayState.aiPrompt && (
          <div className="bg-gray-800/50 rounded-lg p-2 text-xs">
            <p className="text-gray-400 mb-1">ElevenLabs SFX Prompt:</p>
            <p className="text-gray-300 italic">&quot;{overlayState.aiPrompt}&quot;</p>
          </div>
        )}
      </div>

      <div className="relative flex items-center gap-3">
        <div className="flex-1 border-t border-gray-700" />
        <span className="text-xs text-gray-500">or use synthesized</span>
        <div className="flex-1 border-t border-gray-700" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        {SOUND_TYPES.map((sound) => (
          <button
            key={sound.id}
            onClick={() => {
              if (overlayState.isPlaying && overlayState.soundType === sound.id) {
                onStop();
              } else {
                onStart(sound.id, overlayState.volume, overlayState.targetDb);
              }
            }}
            className={`p-3 rounded-lg text-left transition-all ${
              overlayState.isPlaying && overlayState.soundType === sound.id
                ? 'bg-cyan-500/20 border border-cyan-500/50 ring-1 ring-cyan-500/30'
                : 'bg-gray-800/50 border border-gray-700 hover:border-gray-600'
            }`}
          >
            <p className="text-sm font-medium text-white">{sound.label}</p>
            <p className="text-xs text-gray-400">{sound.desc}</p>
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Volume</span>
          <span className="text-white">{Math.round(overlayState.volume * 100)}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round(overlayState.volume * 100)}
          onChange={(e) => onSetVolume(Number(e.target.value) / 100)}
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
        />
      </div>

      {overlayState.isPlaying && (
        <button
          onClick={onStop}
          className="w-full py-2 bg-red-500/20 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/30 transition-colors"
        >
          Stop Overlay
        </button>
      )}
    </div>
  );
}
