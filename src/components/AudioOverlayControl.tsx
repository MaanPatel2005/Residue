'use client';

interface OverlayState {
  isPlaying: boolean;
  soundType: string;
  volume: number;
  targetDb: number;
}

interface Props {
  overlayState: OverlayState;
  onStart: (soundType: string, volume: number, targetDb: number) => void;
  onStop: () => void;
  onSetVolume: (volume: number) => void;
  onSetSoundType: (type: 'brown-noise' | 'pink-noise' | 'white-noise' | 'rain' | 'cafe' | 'binaural') => void;
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
  onSetSoundType,
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
