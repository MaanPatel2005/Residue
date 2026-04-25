/**
 * PRIVACY GUARANTEE: This module captures ONLY keystroke timing data
 * (inter-key latency, hold duration, error rate, typing speed).
 * Keystroke CONTENT is NEVER captured, logged, or stored.
 * All processing is on-device. No keystroke data leaves the browser.
 */

interface KeyEvent {
  timestamp: number;
  holdDuration: number;
  isError: boolean; // backspace / delete
}

const WINDOW_MS = 30_000; // rolling 30-second window
const CHARS_PER_WORD = 5; // standard WPM calculation

export class KeystrokeAnalyzer {
  private events: KeyEvent[] = [];
  private keyDownTimes = new Map<string, number>();
  private lastKeyUpTime = 0;
  private interKeyLatencies: number[] = [];
  private running = false;

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.isTypingTarget(e)) return;
    const code = e.code;
    if (!this.keyDownTimes.has(code)) {
      this.keyDownTimes.set(code, performance.now());
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (!this.isTypingTarget(e)) return;

    const now = performance.now();
    const code = e.code;
    const downTime = this.keyDownTimes.get(code);
    this.keyDownTimes.delete(code);

    const holdDuration = downTime != null ? now - downTime : 0;
    const isError = e.key === 'Backspace' || e.key === 'Delete';

    if (this.lastKeyUpTime > 0) {
      this.interKeyLatencies.push(now - this.lastKeyUpTime);
    }
    this.lastKeyUpTime = now;

    this.events.push({ timestamp: now, holdDuration, isError });
    this.pruneOldEvents(now);
  };

  private isTypingTarget(e: KeyboardEvent): boolean {
    const target = e.target as HTMLElement | null;
    if (!target) return false;
    const tag = target.tagName;
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      target.isContentEditable
    );
  }

  private pruneOldEvents(now: number): void {
    const cutoff = now - WINDOW_MS;
    this.events = this.events.filter((ev) => ev.timestamp >= cutoff);
    this.interKeyLatencies = this.interKeyLatencies.slice(-200);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    document.addEventListener('keydown', this.onKeyDown, { passive: true });
    document.addEventListener('keyup', this.onKeyUp, { passive: true });
  }

  stop(): void {
    this.running = false;
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    this.reset();
  }

  reset(): void {
    this.events = [];
    this.keyDownTimes.clear();
    this.lastKeyUpTime = 0;
    this.interKeyLatencies = [];
  }

  /** Rolling 30s WPM. */
  getTypingSpeed(): number {
    const now = performance.now();
    const cutoff = now - WINDOW_MS;
    const recentKeys = this.events.filter(
      (ev) => ev.timestamp >= cutoff && !ev.isError
    );
    if (recentKeys.length < 2) return 0;
    const elapsedMin = WINDOW_MS / 60_000;
    return recentKeys.length / CHARS_PER_WORD / elapsedMin;
  }

  /** Backspace / delete events per minute in the window. */
  getErrorRate(): number {
    const now = performance.now();
    const cutoff = now - WINDOW_MS;
    const errors = this.events.filter(
      (ev) => ev.timestamp >= cutoff && ev.isError
    );
    const elapsedMin = WINDOW_MS / 60_000;
    return errors.length / elapsedMin;
  }

  /** Mean inter-key latency in ms over recent events. */
  getInterKeyLatency(): number {
    if (this.interKeyLatencies.length === 0) return 0;
    const recent = this.interKeyLatencies.slice(-50);
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }

  getSnapshot() {
    return {
      typingSpeed: this.getTypingSpeed(),
      errorRate: this.getErrorRate(),
      interKeyLatency: this.getInterKeyLatency(),
    };
  }
}
