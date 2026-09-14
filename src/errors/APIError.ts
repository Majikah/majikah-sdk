import { MajikahError } from "./MajikahError";

// errors/APIError.ts
export class APIError extends MajikahError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "APIError";
  }
}
