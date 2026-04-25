/**
 * PRIVACY GUARANTEE: This module captures ONLY mouse movement metrics
 * (jitter, scroll velocity, idle time). No screen content, click targets,
 * or user-identifiable information is ever captured or stored.
 * All processing is on-device. No data leaves the browser.
 */

interface MouseSample {
  x: number;
  y: number;
  timestamp: number;
}

const SAMPLE_INTERVAL_MS = 33; // ~30 Hz
const JITTER_WINDOW = 60;     // samples for jitter calc (~2s at 30Hz)
const SCROLL_WINDOW_MS = 5_000;

export class MouseAnalyzer {
  private samples: MouseSample[] = [];
  private scrollEvents: { timestamp: number; deltaY: number }[] = [];
  private lastMoveTime = 0;
  private running = false;
  private lastSampleTime = 0;

  private onMouseMove = (e: MouseEvent): void => {
    const now = performance.now();
    if (now - this.lastSampleTime < SAMPLE_INTERVAL_MS) return;
    this.lastSampleTime = now;
    this.lastMoveTime = now;

    this.samples.push({ x: e.clientX, y: e.clientY, timestamp: now });
    if (this.samples.length > 200) {
      this.samples = this.samples.slice(-150);
    }
  };

  private onScroll = (e: WheelEvent): void => {
    const now = performance.now();
    this.scrollEvents.push({ timestamp: now, deltaY: Math.abs(e.deltaY) });
    const cutoff = now - SCROLL_WINDOW_MS;
    this.scrollEvents = this.scrollEvents.filter((s) => s.timestamp >= cutoff);
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    document.addEventListener('mousemove', this.onMouseMove, { passive: true });
    document.addEventListener('wheel', this.onScroll, { passive: true });
  }

  stop(): void {
    this.running = false;
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('wheel', this.onScroll);
    this.reset();
  }

  reset(): void {
    this.samples = [];
    this.scrollEvents = [];
    this.lastMoveTime = 0;
    this.lastSampleTime = 0;
  }

  /**
   * Mouse jitter: average deviation from a linear interpolation
   * between every 3rd sample point. Higher = more erratic movement.
   */
  getJitter(): number {
    const recent = this.samples.slice(-JITTER_WINDOW);
    if (recent.length < 6) return 0;

    let totalDeviation = 0;
    let count = 0;

    for (let i = 2; i < recent.length; i += 3) {
      const a = recent[i - 2];
      const b = recent[i - 1];
      const c = recent[i];

      // expected midpoint on line a→c
      const expectedX = (a.x + c.x) / 2;
      const expectedY = (a.y + c.y) / 2;
      const dx = b.x - expectedX;
      const dy = b.y - expectedY;
      totalDeviation += Math.sqrt(dx * dx + dy * dy);
      count++;
    }

    return count > 0 ? totalDeviation / count : 0;
  }

  /** Scroll velocity in px/s over recent window. */
  getScrollVelocity(): number {
    if (this.scrollEvents.length === 0) return 0;
    const totalDelta = this.scrollEvents.reduce((s, e) => s + e.deltaY, 0);
    return totalDelta / (SCROLL_WINDOW_MS / 1000);
  }

  /** Idle time in ms since last mouse move. */
  getIdleTime(): number {
    if (this.lastMoveTime === 0) return Infinity;
    return performance.now() - this.lastMoveTime;
  }

  getSnapshot() {
    return {
      mouseJitter: this.getJitter(),
      scrollVelocity: this.getScrollVelocity(),
      idleTimeMs: this.getIdleTime(),
    };
  }
}
