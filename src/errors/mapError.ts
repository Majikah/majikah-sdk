// errors/mapError.ts
import { APIError } from "./APIError";
import { AuthenticationError } from "./AuthenticationError";
import { QuotaExhaustedError } from "./QuotaExhaustedError";
import { RateLimitError } from "./RateLimitError";
import { ServiceUnavailableError } from "./ServiceUnavailableError";
import type { ApiErrorBody } from "../types/common";

export function mapError(
  status: number,
  body: ApiErrorBody | undefined,
  requestId?: string,
  retryAfterMs?: number,
): APIError {
  const message = body?.error ?? `Request failed with status ${status}`;
  const code = body?.code ?? "UNKNOWN_ERROR";

  switch (status) {
    case 401:
      return new AuthenticationError(message, status, code, requestId);
    case 402:
      return new QuotaExhaustedError(message, status, code, requestId);
    case 429:
      return new RateLimitError(message, status, code, retryAfterMs, requestId);
    case 503:
      return new ServiceUnavailableError(message, status, code, requestId);
    default:
      return new APIError(message, status, code, requestId);
  }
}
