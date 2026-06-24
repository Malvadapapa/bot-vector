// ============================================================
// DelayService — Simulates network latency
// ============================================================

const DEFAULT_DELAY = 400;

/**
 * Simulate network delay. Returns a promise that resolves after `ms` milliseconds.
 */
export function simulateDelay(ms: number = DEFAULT_DELAY): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Simulate an occasionally slower network (adds jitter).
 */
export function simulateRealisticDelay(): Promise<void> {
  const base = 300;
  const jitter = Math.random() * 400; // 0-400ms extra
  return simulateDelay(base + jitter);
}
