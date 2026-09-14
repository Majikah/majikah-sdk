// errors/MajikahError.ts
export class MajikahError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "MajikahError";
  }
}
