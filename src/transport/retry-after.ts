/**
 * Parses the standard HTTP `Retry-After` header into milliseconds.
 *
 * Per RFC 9110 §10.2.3, the header may be either:
 *   1. delay-seconds — an integer number of seconds, e.g. "120"
 *   2. HTTP-date — an absolute timestamp, e.g. "Wed, 21 Oct 2026 07:28:00 GMT"
 *
 * Our gateway (buildGatewayResponseHeaders) currently only emits form 1,
 * but a CDN or edge layer in front of it could plausibly inject form 2,
 * so both are handled here rather than assuming the numeric case always
 * holds.
 *
 * Returns undefined when the header is missing or doesn't parse as
 * either form — callers treat that as "no server-specified wait,
 * fall back to our own backoff schedule."
 */
export function parseRetryAfterMs(res: Response): number | undefined {
  const header = res.headers.get("retry-after");
  if (!header) return undefined;

  const trimmed = header.trim();

  // Form 1: delay-seconds. Must be a non-negative integer per spec —
  // reject negative numbers and non-integer garbage like "12.5abc"
  // that Number() would otherwise coerce leniently.
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return seconds * 1000;
  }

  // Form 2: HTTP-date. Date.parse handles RFC 7231 IMF-fixdate format
  // (and is lenient enough to also accept a few common variants).
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return undefined;

  const deltaMs = dateMs - Date.now();
  // A date in the past (clock skew, or server told us to retry
  // "immediately" via an already-elapsed timestamp) should mean
  // "no additional wait," not a negative sleep duration.
  return Math.max(deltaMs, 0);
}
