import { APIError } from "./APIError";

// errors/QuotaExhaustedError.ts — 402, TSA-specific but generic enough to live here
export class QuotaExhaustedError extends APIError {}
