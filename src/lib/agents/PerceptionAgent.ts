/**
 * PerceptionAgent — runs in the browser (client-side).
 *
 * Subscribes to window.__residueAcoustic (from Agent A's audio pipeline)
 * and window.__residueBehavior (from BehaviorTracker) at 10Hz.
 * Maintains a rolling state estimate and broadcasts state-change events
 * via window.__residuePerception.
 *
 * Architecture role (Cognition pitch): The perception layer that gives
 * agents acoustic environment awareness as a first-class context type.
 */

import type {
  BehavioralFeatureVector,
  PerceptionState,
  CognitiveState,
  StateChangeEvent,
  AgentMessage,
} from '@/lib/types/agents';
import type { AcousticProfile } from '@/types';

const POLL_INTERVAL_MS = 100; // 10 Hz
const STATE_HISTORY_SIZE = 30; // ~3 seconds of state history at 10Hz

type StateChangeHandler = (event: StateChangeEvent) => void;

export class PerceptionAgent {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private previousState: CognitiveState = 'idle';
  private stateHistory: PerceptionState[] = [];
  private handlers: StateChangeHandler[] = [];

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  onStateChange(handler: StateChangeHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  getState(): PerceptionState | null {
    return this.stateHistory[this.stateHistory.length - 1] ?? null;
  }

  private tick(): void {
    if (typeof window === 'undefined') return;

    const acoustic: AcousticProfile | null = window.__residueAcoustic ?? null;
    const behavioral: BehavioralFeatureVector | null = window.__residueBehavior ?? null;

    const cognitiveState = this.inferState(acoustic, behavioral);
    const confidence = this.computeConfidence(acoustic, behavioral);

    const state: PerceptionState = {
      acoustic,
      behavioral,
      cognitiveState,
      confidence,
      timestamp: Date.now(),
    };

    this.stateHistory.push(state);
    if (this.stateHistory.length > STATE_HISTORY_SIZE) {
      this.stateHistory = this.stateHistory.slice(-STATE_HISTORY_SIZE);
    }

    window.__residuePerception = state;

    if (cognitiveState !== this.previousState) {
      const event: StateChangeEvent = {
        previous: this.previousState,
        current: cognitiveState,
        acoustic,
        behavioral,
        timestamp: Date.now(),
      };
      this.previousState = cognitiveState;
      for (const handler of this.handlers) {
        handler(event);
      }
    }
  }

  /**
   * Infer cognitive state from acoustic + behavioral signals.
   * Uses a simple rule-based classifier (sufficient for MVP;
   * ZETIC on-device ML can replace this).
   */
  private inferState(
    acoustic: AcousticProfile | null,
    behavioral: BehavioralFeatureVector | null
  ): CognitiveState {
    if (!behavioral) return 'idle';

    const { typingSpeed, errorRate, mouseJitter, focusSwitchRate } = behavioral;

    // Idle: no typing, no mouse movement
    if (typingSpeed < 2 && mouseJitter < 1) return 'idle';

    // Distracted: high error rate, high focus switching, high jitter
    if (focusSwitchRate > 8 || (errorRate > 10 && mouseJitter > 15)) {
      return 'distracted';
    }

    // Focused: steady typing, low error rate, low switching
    if (typingSpeed > 15 && errorRate < 5 && focusSwitchRate < 3) {
      return 'focused';
    }

    return 'transitioning';
  }

  private computeConfidence(
    acoustic: AcousticProfile | null,
    behavioral: BehavioralFeatureVector | null
  ): number {
    let c = 0;
    if (acoustic) c += 0.4;
    if (behavioral) c += 0.4;
    if (this.stateHistory.length >= 10) c += 0.2;
    return Math.min(c, 1);
  }

  /** Build an agent message for inter-agent communication. */
  buildMessage<T>(
    recipient: string,
    type: string,
    payload: T
  ): AgentMessage<T> {
    return {
      sender: 'agent://residue/perception',
      recipient,
      type,
      payload,
      timestamp: Date.now(),
    };
  }
}

let instance: PerceptionAgent | null = null;

export function getPerceptionAgent(): PerceptionAgent {
  if (!instance) {
    instance = new PerceptionAgent();
  }
  return instance;
}
