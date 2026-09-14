/**
 * Supported service groups exposed by the Majikah API.
 */
export type ServiceGroup = "tsa" | "notary" | "slink" | "muid";

/**
 * Maps each service group to the URL path segment used by the API.
 */
export const SERVICE_ROUTE_SEGMENT: Record<ServiceGroup, string> = {
  tsa: "tsa",
  notary: "notary",
  slink: "slink",
  muid: "muid",
} as const;

/**
 * Configuration options for the Majikah API client.
 */
export interface MajikahClientOptions {
  /** API key used to authenticate requests. */
  apiKey: string;

  /** Base URL of the Majikah public API. */
  baseUrl?: string;

  /**
   * API version to use for all services, or individual versions per service.
   *
   * A numeric value applies to every service unless overridden by a
   * service-specific version.
   */
  version?: number | Partial<Record<ServiceGroup, number>>;

  /** Maximum time, in milliseconds, allowed for a single request. */
  timeoutMs?: number;

  /** Additional HTTP headers sent with every request. */
  headers?: Record<string, string>;

  /** Fetch implementation used for HTTP requests. Defaults to the environment's `fetch`. */
  fetch?: typeof fetch;

  /** Request retry behavior. */
  retry?: RetryOptions;
}

/**
 * Controls how failed API requests are retried.
 */
export interface RetryOptions {
  /** Maximum number of request attempts, including the initial request. */
  maxAttempts?: number;

  /** Initial delay before the first retry, in milliseconds. */
  initialDelayMs?: number;

  /** Randomization factor applied to retry delays to reduce request synchronization. */
  jitterFactor?: number;

  /** Maximum retry delay, in milliseconds. */
  capDelayMs?: number;
}

/**
 * Default configuration used by the Majikah API client when options are omitted.
 */
export const MAJIKAH_CLIENT_DEFAULTS = {
  baseUrl: "https://api-public.majikah.solutions",
  version: 1,
  timeoutMs: 15_000,
  retry: {
    maxAttempts: 3,
    initialDelayMs: 300,
    jitterFactor: 0.4,
    capDelayMs: 5_000,
  } as Required<RetryOptions>,
} as const;

/**
 * Resolves the effective API version for every supported service.
 *
 * A single numeric version is used as the default for all services.
 * Service-specific versions override that default when provided.
 *
 * @param version Global API version or per-service version overrides.
 * @returns A complete version map containing a version for every service.
 */
export function resolveVersions(
  version: MajikahClientOptions["version"],
): Record<ServiceGroup, number> {
  const fallback =
    typeof version === "number" ? version : MAJIKAH_CLIENT_DEFAULTS.version;

  const overrides =
    typeof version === "object" && version !== null ? version : {};

  return {
    tsa: overrides.tsa ?? fallback,
    notary: overrides.notary ?? fallback,
    slink: overrides.slink ?? fallback,
    muid: overrides.muid ?? fallback,
  };
}

/**
 * Standard success response returned by the Majikah API.
 *
 * @typeParam T Type of the successful response data.
 */
export interface ApiSuccessBody<T> {
  /** Indicates that the API request completed successfully. */
  success: true;

  /** Human-readable description of the operation result. */
  message: string;

  /** Data returned by the requested operation. */
  data: T;
}

/**
 * Standard error response returned by the Majikah API.
 */
export interface ApiErrorBody {
  /** Indicates that the API request failed. */
  success: false;

  /** Human-readable description of the error. */
  error: string;

  /** Optional machine-readable error code. */
  code?: string;
}

/**
 * Union of the standard successful and failed Majikah API responses.
 *
 * Use the `success` property as the discriminator when handling a response.
 *
 * @typeParam T Type of the successful response data.
 */
export type ApiResponseBody<T> = ApiSuccessBody<T> | ApiErrorBody;

/**
 * Cursor-based pagination result returned by a Majikah API list endpoint.
 *
 * The `next_cursor` value is opaque and should be passed back unchanged as
 * the `cursor` parameter when requesting the next page.
 *
 * @typeParam T Type of items returned in the current page.
 */
export interface PageResult<T> {
  /** Items returned for the current page. */
  items: T[];

  /**
   * Opaque cursor for retrieving the next page.
   *
   * `null` indicates that there is no next page.
   */
  next_cursor: string | null;

  /** Indicates whether another page of results is available. */
  has_more: boolean;

  /** Number of items returned in the current page. */
  count: number;

  /** Maximum number of items requested for the current page. */
  limit: number;
}

/**
 * Parameters used to request a page of cursor-based results.
 */
export interface PaginationParams {
  /**
   * Opaque cursor returned by the previous page.
   *
   * Omit this value to request the first page.
   */
  cursor?: string;

  /** Maximum number of items to return in the page. */
  limit?: number;
}
