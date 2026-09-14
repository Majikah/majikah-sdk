import { APIError } from "./APIError";

// errors/ServiceUnavailableError.ts — 503, e.g. TSA ledger's fail-closed Redis case
export class ServiceUnavailableError extends APIError {}
