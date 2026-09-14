import { ValidationError } from "../../errors/ValidationError";

/**
 * Normalizes a URL by adding `https://` when no HTTP(S) scheme is present.
 *
 * The returned value is intentionally not percent-encoded. Query parameter
 * encoding is handled by the HTTP client when the request URL is built,
 * preventing double encoding.
 *
 * @param input URL or domain to normalize.
 * @returns A normalized HTTP(S) URL.
 * @throws ValidationError When the input is empty or not a string.
 *
 * @example
 * ```ts
 * normalizeUrl("thezelijah.world");
 * // "https://thezelijah.world"
 *
 * normalizeUrl("http://thezelijah.world");
 * // "http://thezelijah.world"
 *
 * normalizeUrl("https://thezelijah.world");
 * // "https://thezelijah.world"
 * ```
 */
export function normalizeUrl(input: string): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new ValidationError("url must be a non-empty string", input);
  }

  const trimmed = input.trim();

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
