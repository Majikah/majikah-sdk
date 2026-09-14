import { APIError } from "./APIError";

// errors/RateLimitError.ts — 429
export class RateLimitError extends APIError {
  constructor(
    message: string,
    status: number,
    code: string,
    public readonly retryAfterMs?: number,
    requestId?: string,
  ) {
    super(message, status, code, requestId);
    this.name = "RateLimitError";
  }
}
