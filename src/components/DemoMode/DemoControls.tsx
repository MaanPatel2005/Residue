'use client';

/**
 * The three big "demo moment" buttons:
 *   - Raw Environment   → bypass EQ, mic-through
 *   - My Optimal Profile → apply learned EQ + bed
 *   - A/B Toggle (3s)   → auto-flip every 3 seconds
 */

import type { DemoMode } from '@/lib/types/state';

export interface DemoControlsProps {
  mode: DemoMode;
  abLeg: 'raw' | 'optimal' | null;
  onSelect: (mode: DemoMode) => void;
}

const BUTTONS: { id: DemoMode; label: string; subtitle: string }[] = [
  {
    id: 'raw',
    label: 'Raw Environment',
    subtitle: 'EQ bypassed — straight mic to ear',
  },
  {
    id: 'optimal',
    label: 'My Optimal Profile',
    subtitle: 'learned EQ + ducked bed',
  },
  {
    id: 'ab-toggle',
    label: 'A/B Toggle',
    subtitle: 'auto-flip every 3s',
  },
];

export default function DemoControls({ mode, abLeg, onSelect }: DemoControlsProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 12,
      }}
    >
      {BUTTONS.map((b) => {
        const active = mode === b.id;
        const showAbLeg = b.id === 'ab-toggle' && active && abLeg;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onSelect(b.id)}
            style={{
              padding: '16px 14px',
              borderRadius: 14,
              border: active ? '1px solid #6ad6ff' : '1px solid #22224a',
              background: active ? 'linear-gradient(180deg, #182550, #0e1837)' : '#0e0e22',
              color: '#ededed',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'transform 80ms ease, border-color 120ms ease',
              transform: active ? 'translateY(-1px)' : 'none',
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700 }}>{b.label}</div>
            <div style={{ fontSize: 11, color: '#9aa0c8', marginTop: 4 }}>{b.subtitle}</div>
            {showAbLeg && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  color: abLeg === 'optimal' ? '#a4ffb4' : '#6ad6ff',
                }}
              >
                NOW PLAYING: {abLeg === 'optimal' ? 'OPTIMAL' : 'RAW'}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
