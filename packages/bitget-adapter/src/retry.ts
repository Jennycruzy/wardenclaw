/**
 * Small retry helper with exponential backoff + jitter, used to ride out Bitget's
 * transient HTTP 429 (Too Many Requests) and network blips when polling public
 * market data for several symbols per cycle.
 *
 * It NEVER masks a real failure: only errors the caller marks retryable are
 * retried, and once the attempt budget is spent the last error is re-thrown loudly.
 * Both the delay and the budget are injectable so tests run instantly and
 * deterministically.
 */

export interface RetryOptions {
  /** Max retry attempts AFTER the first try (default 3). */
  retries?: number;
  /** Base backoff in ms; attempt N waits ~base * 2^(N-1) plus jitter (default 400). */
  baseDelayMs?: number;
  /** Returns true if this error should be retried. */
  shouldRetry: (err: unknown) => boolean;
  /** Injectable sleep (defaults to setTimeout); tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter in [0,1) (defaults to Math.random); tests pass 0. */
  jitter?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 400;
  const sleep = opts.sleep ?? defaultSleep;
  const jitter = opts.jitter ?? Math.random;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !opts.shouldRetry(err)) throw err;
      const delay = base * 2 ** attempt + Math.floor(jitter() * base);
      await sleep(delay);
    }
  }
  // Unreachable: the loop either returns or throws, but satisfies the type checker.
  throw lastErr;
}
