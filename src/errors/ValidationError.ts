import { MajikahError } from "./MajikahError";

// errors/ValidationError.ts — client-side, thrown before any network call
export class ValidationError extends MajikahError {
  constructor(
    message: string,
    public readonly issues: unknown,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}
