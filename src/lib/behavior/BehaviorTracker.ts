/**
 * PRIVACY GUARANTEE: This module aggregates behavioral signals into a
 * numeric feature vector. No keystroke content, screen content, or
 * user-identifiable data is ever captured or stored.
 * All processing is on-device. No data leaves the browser.
 */

import { KeystrokeAnalyzer } from './KeystrokeAnalyzer';
import { MouseAnalyzer } from './MouseAnalyzer';
import type { BehavioralFeatureVector } from '@/lib/types/agents';

const PUBLISH_INTERVAL_MS = 100; // 10 Hz
const FOCUS_WINDOW_MS = 60_000;  // 1-minute window for focus switch rate

export class BehaviorTracker {
  private keystroke = new KeystrokeAnalyzer();
  private mouse = new MouseAnalyzer();

  private focusEvents: number[] = [];
  private documentVisible = true;
  private publishTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  private onVisibilityChange = (): void => {
    const wasVisible = this.documentVisible;
    this.documentVisible = !document.hidden;
    if (wasVisible !== this.documentVisible) {
      this.focusEvents.push(performance.now());
      this.pruneFocusEvents();
    }
  };

  private onWindowBlur = (): void => {
    this.focusEvents.push(performance.now());
    this.pruneFocusEvents();
  };

  private onWindowFocus = (): void => {
    this.focusEvents.push(performance.now());
    this.pruneFocusEvents();
  };

  private pruneFocusEvents(): void {
    const cutoff = performance.now() - FOCUS_WINDOW_MS;
    this.focusEvents = this.focusEvents.filter((t) => t >= cutoff);
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    this.keystroke.start();
    this.mouse.start();

    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('blur', this.onWindowBlur);
    window.addEventListener('focus', this.onWindowFocus);

    this.publishTimer = setInterval(() => this.publish(), PUBLISH_INTERVAL_MS);
  }

  stop(): void {
    this.running = false;

    this.keystroke.stop();
    this.mouse.stop();

    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('blur', this.onWindowBlur);
    window.removeEventListener('focus', this.onWindowFocus);

    if (this.publishTimer !== null) {
      clearInterval(this.publishTimer);
      this.publishTimer = null;
    }
  }

  /** Focus switch rate: switches per minute in the last 60s. */
  private getFocusSwitchRate(): number {
    this.pruneFocusEvents();
    return this.focusEvents.length; // already scoped to 1-minute window
  }

  /** Build the 6-dim feature vector. */
  getFeatureVector(): BehavioralFeatureVector {
    const ks = this.keystroke.getSnapshot();
    const ms = this.mouse.getSnapshot();

    return {
      typingSpeed: ks.typingSpeed,
      errorRate: ks.errorRate,
      interKeyLatency: ks.interKeyLatency,
      mouseJitter: ms.mouseJitter,
      scrollVelocity: ms.scrollVelocity,
      focusSwitchRate: this.getFocusSwitchRate(),
      timestamp: Date.now(),
    };
  }

  /** Publish the current feature vector to window.__residueBehavior at 10Hz. */
  private publish(): void {
    if (typeof window === 'undefined') return;
    const vec = this.getFeatureVector();
    window.__residueBehavior = vec;
  }
}

/** Singleton for app-wide usage. */
let tracker: BehaviorTracker | null = null;

export function getBehaviorTracker(): BehaviorTracker {
  if (!tracker) {
    tracker = new BehaviorTracker();
  }
  return tracker;
}
