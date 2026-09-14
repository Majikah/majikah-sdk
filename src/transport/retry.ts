import { APIError } from "../errors/APIError";
import { RateLimitError } from "../errors/RateLimitError";
import { MajikahError } from "../errors/MajikahError";
import type { RetryOptions } from "../types/common";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Whether an error is worth retrying at all.
 *
 * - 5xx / ServiceUnavailableError: transient server-side failure, safe to retry.
 * - RateLimitError (429): retry, but respect Retry-After if the server gave one
 *   rather than our own backoff schedule (see retryWithBackoff below).
 * - MajikahError with no APIError subtype (timeout, network failure, JSON
 *   parse failure before a status code was even assigned): also transient.
 * - Anything else — 4xx like 400/401/402/404, or a client-side ValidationError
 *   that never left the machine — is not retryable. Retrying a malformed
 *   request or a bad API key just wastes attempts and delays surfacing a
 *   fixable problem.
 */
function isRetryable(err: unknown): boolean {
  if (err instanceof RateLimitError) return true;
  if (err instanceof APIError) return err.status >= 500;
  if (err instanceof MajikahError) return true; // timeout / network-level failure
  return false;
}

/**
 * Retries an async function with exponential backoff + jitter.
 * Only retries errors that pass `isRetryable` — caller still decides
 * (via HttpClient) whether this method should be attempted more than
 * once at all, e.g. non-idempotent POSTs like tsa.issue never call this.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: Required<RetryOptions>,
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void,
): Promise<T> {
  const { maxAttempts, initialDelayMs, jitterFactor, capDelayMs } = options;

  let attempt = 0;
  let delay = initialDelayMs;

  while (attempt < maxAttempts) {
    try {
      return await fn();
    } catch (err) {
      attempt++;

      if (!isRetryable(err) || attempt >= maxAttempts) {
        throw err;
      }

      // A server-specified Retry-After overrides our own schedule for 429s —
      // it's the server telling us exactly when it'll accept work again,
      // more reliable than guessing with backoff math.
      const waitMs =
        err instanceof RateLimitError && err.retryAfterMs !== undefined
          ? err.retryAfterMs
          : delay;

      onRetry?.(attempt, waitMs, err);
      await sleep(waitMs);

      delay = Math.min(
        Math.round(delay * (1.5 + Math.random() * jitterFactor)),
        capDelayMs,
      );
    }
  }

  // Unreachable — loop always returns or throws — but keeps TS satisfied.
  throw new MajikahError(
    `Retry loop exited unexpectedly after ${maxAttempts} attempts`,
  );
}
