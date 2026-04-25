/**
 * Cross-agent runtime store, exposed at `window.__residueState`.
 *
 * Both Agent A (DSP / acoustic / ML) and Agent B (agents, behaviour,
 * ElevenLabs) read and write through this store. Type contract lives in
 * `lib/types/state.ts`.
 *
 * The store is intentionally tiny — no React context, no Zustand. It must
 * survive HMR boundaries and be safe to call from non-React code (workers,
 * audio worklets, ML inference loops, etc).
 */

import {
  DEFAULT_RESIDUE_STATE,
  type ResidueState,
  type ResidueStateListener,
  type ResidueStateStore,
} from '@/lib/types/state';

function createStore(initial: ResidueState): ResidueStateStore {
  let state: ResidueState = { ...initial };
  const listeners = new Set<ResidueStateListener>();

  return {
    getState: () => state,
    setState: (patch) => {
      state = { ...state, ...patch };
      listeners.forEach((fn) => {
        try {
          fn(state);
        } catch (err) {
          console.error('[residue/store] listener threw', err);
        }
      });
    },
    subscribe: (fn) => {
      listeners.add(fn);
      // Fire once with current state so subscribers can sync immediately.
      try {
        fn(state);
      } catch (err) {
        console.error('[residue/store] subscribe init threw', err);
      }
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/**
 * Lazily instantiate (or reuse) the singleton store on `window.__residueState`.
 *
 * On the server side (no `window`), returns a fresh, isolated instance so SSR
 * components can safely call `getState()`. The browser-side instance is the
 * one Agent B will see.
 */
export function getResidueStore(): ResidueStateStore {
  if (typeof window === 'undefined') {
    return createStore(DEFAULT_RESIDUE_STATE);
  }
  if (!window.__residueState) {
    window.__residueState = createStore(DEFAULT_RESIDUE_STATE);
  }
  return window.__residueState;
}
