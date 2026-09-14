import { RouteResolver } from "./RouteResolver";
import { mapError } from "../errors/mapError";
import { MajikahError } from "../errors/MajikahError";
import {
  MAJIKAH_CLIENT_DEFAULTS,
  resolveVersions,
  type ApiResponseBody,
  type MajikahClientOptions,
  type RetryOptions,
  type ServiceGroup,
} from "../types/common";
import { retryWithBackoff } from "./retry";
import { parseRetryAfterMs } from "./retry-after";

/**
 * Options for an individual HTTP request made through the API client.
 */
interface RequestOptions {
  /** HTTP method used for the request. */
  method: "GET" | "POST" | "DELETE";

  /** Query parameters appended to the request URL. */
  query?: Record<string, string | undefined>;

  /** Request body that will be serialized as JSON. */
  body?: unknown;

  /**
   * Marks a POST request as safe to retry.
   *
   * Use this only when the operation is idempotent and repeating it cannot
   * create an unintended side effect.
   */
  idempotent?: boolean;
}

/**
 * Internal HTTP transport used by the Majikah SDK service clients.
 *
 * Handles API URL resolution, authentication headers, request timeouts,
 * response parsing, error mapping, and retry behavior for retry-safe requests.
 */
export class HttpClient {
  private readonly routes: RouteResolver;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly retry: Required<RetryOptions>;
  private readonly fetchImpl: typeof fetch;
  private readonly extraHeaders: Record<string, string>;

  /**
   * Creates an HTTP client from the SDK configuration.
   *
   * @param options API client configuration including authentication,
   * timeout, retry, and transport settings.
   * @throws MajikahError When no API key is provided.
   */
  constructor(options: MajikahClientOptions) {
    if (!options.apiKey) {
      throw new MajikahError("MajikahSDKClient requires an apiKey");
    }

    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? MAJIKAH_CLIENT_DEFAULTS.timeoutMs;
    this.retry = {
      ...MAJIKAH_CLIENT_DEFAULTS.retry,
      ...(options.retry ?? {}),
    };
    this.fetchImpl = options.fetch ?? fetch;
    this.extraHeaders = options.headers ?? {};
    this.routes = new RouteResolver(
      options.baseUrl ?? MAJIKAH_CLIENT_DEFAULTS.baseUrl,
      resolveVersions(options.version),
    );
  }

  /**
   * Sends a request to a Majikah API service.
   *
   * GET requests are automatically retried according to the configured retry
   * policy. POST requests are only retried when explicitly marked as
   * idempotent.
   *
   * Successful API responses are unwrapped and return their `data` value
   * directly. API errors are converted into SDK-specific error types.
   *
   * @typeParam T Expected type of the unwrapped response data.
   * @param group Service group receiving the request.
   * @param path API path relative to the service route.
   * @param opts HTTP method, query parameters, body, and retry settings.
   * @returns The response data returned by the API.
   * @throws MajikahError When the request fails or times out.
   * @throws RateLimitError When the API rejects the request due to rate limits.
   */
  async request<T>(
    group: ServiceGroup,
    path: string,
    opts: RequestOptions,
  ): Promise<T> {
    const url = this.buildUrl(group, path, opts.query);
    const canRetry = opts.method === "GET" || opts.idempotent === true;

    if (!canRetry) {
      return this.attempt<T>(url, opts);
    }

    return retryWithBackoff(() => this.attempt<T>(url, opts), this.retry);
  }

  /**
   * Builds a fully resolved API URL from a service route and query parameters.
   *
   * Undefined query values are omitted from the final URL.
   *
   * @param group Service group used to resolve the API route.
   * @param path API path relative to the resolved service route.
   * @param query Optional query parameters.
   * @returns Fully resolved request URL.
   */
  private buildUrl(
    group: ServiceGroup,
    path: string,
    query?: Record<string, string | undefined>,
  ): URL {
    const url = new URL(this.routes.build(group, path));

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, value);
        }
      }
    }

    return url;
  }

  /**
   * Executes a single HTTP request without retrying.
   *
   * The response envelope is validated and unwrapped before returning the
   * contained data. HTTP and API errors are converted through `mapError()`.
   *
   * @typeParam T Expected type of the unwrapped response data.
   * @param url Fully resolved request URL.
   * @param opts Request configuration.
   * @returns The response data returned by the API.
   * @throws MajikahError When the request times out or the API returns an error.
   */
  private async attempt<T>(url: URL, opts: RequestOptions): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchImpl(url.toString(), {
        method: opts.method,
        headers: {
          "X-API-KEY": this.apiKey,
          ...(opts.body ? { "Content-Type": "application/json" } : {}),
          ...this.extraHeaders,
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      const requestId = res.headers.get("x-request-id") ?? undefined;
      const json = (await res.json().catch(() => undefined)) as
        | ApiResponseBody<T>
        | undefined;

      if (!res.ok || !json || json.success === false) {
        throw mapError(
          res.status,
          json && json.success === false ? json : undefined,
          requestId,
          res.status === 429 ? parseRetryAfterMs(res) : undefined,
        );
      }

      return json.data;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new MajikahError(`Request timed out after ${this.timeoutMs}ms`);
      }

      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

// Freeze static methods
Object.freeze(HttpClient);

// Freeze instance methods
Object.freeze(HttpClient.prototype);
