'use client';

type Mode = 'focus' | 'calm' | 'creative' | 'social';

interface Props {
  currentMode: Mode;
  onModeChange: (mode: Mode) => void;
}

const MODES: { id: Mode; label: string; icon: string; desc: string }[] = [
  { id: 'focus', label: 'Focus', icon: '🎯', desc: 'Deep work & studying' },
  { id: 'calm', label: 'Calm', icon: '🧘', desc: 'Relaxation & meditation' },
  { id: 'creative', label: 'Creative', icon: '🎨', desc: 'Brainstorming & ideation' },
  { id: 'social', label: 'Social', icon: '💬', desc: 'Group work & discussion' },
];

export default function ModeSelector({ currentMode, onModeChange }: Props) {
  return (
    <div className="flex gap-2">
      {MODES.map((mode) => (
        <button
          key={mode.id}
          onClick={() => onModeChange(mode.id)}
          className={`flex-1 p-3 rounded-xl text-center transition-all ${
            currentMode === mode.id
              ? 'bg-cyan-500/20 border-2 border-cyan-500/50 ring-1 ring-cyan-500/20'
              : 'bg-gray-800/50 border-2 border-transparent hover:border-gray-700'
          }`}
        >
          <span className="text-2xl">{mode.icon}</span>
          <p className={`text-sm font-medium mt-1 ${
            currentMode === mode.id ? 'text-cyan-400' : 'text-gray-300'
          }`}>
            {mode.label}
          </p>
          <p className="text-xs text-gray-500">{mode.desc}</p>
        </button>
      ))}
    </div>
  );
}
