import type { ServiceGroup } from "../types/common";
import { SERVICE_ROUTE_SEGMENT } from "../types/common";

/**
 * Resolves logical service routes into fully qualified, versioned API URLs.
 *
 * `RouteResolver` centralizes URL construction so individual service clients
 * do not need to know the gateway's route prefixes or API versioning scheme.
 *
 * The resolver:
 * - maps a {@link ServiceGroup} to its configured route segment;
 * - applies the configured API version for that service group;
 * - normalizes the base URL to prevent duplicate path separators; and
 * - normalizes the route path to ensure it begins with `/`.
 *
 * Instances are intentionally treated as immutable after construction.
 */
export class RouteResolver {
  /**
   * Creates a route resolver for the configured API gateway.
   *
   * @param baseUrl - Base URL of the API gateway, with or without a trailing `/`.
   * @param versions - API version number for each supported service group.
   */
  constructor(
    private readonly baseUrl: string,
    private readonly versions: Record<ServiceGroup, number>,
  ) {}

  /**
   * Builds a fully qualified, versioned route for a service.
   *
   * The resulting URL has the following structure:
   *
   * `BASE_URL/SERVICE_SEGMENT/vVERSION/PATH`
   *
   * Both `baseUrl` and `path` are normalized, so callers may provide
   * either leading or trailing slashes without producing duplicate `/`
   * separators at the join points.
   *
   * @param group - Logical service group whose route segment and API version
   *                should be used.
   * @param path - Service-relative route path, with or without a leading `/`.
   * @returns The fully qualified, versioned API route.
   *
   * @example
   * ```ts
   * const resolver = new RouteResolver("https://api.example.com/", {
   *   tsa: 1,
   *   muid: 1,
   * });
   *
   * resolver.build("tsa", "/timestamp");
   * // "https://api.example.com/tsa/v1/timestamp"
   * ```
   */
  build(group: ServiceGroup, path: string): string {
    const segment = SERVICE_ROUTE_SEGMENT[group];
    const version = this.versions[group];

    const cleanBase = this.baseUrl.replace(/\/+$/, "");
    const cleanPath = path.startsWith("/") ? path : `/${path}`;

    return `${cleanBase}/${segment}/v${version}${cleanPath}`;
  }
}

// Freeze static methods
Object.freeze(RouteResolver);

// Freeze instance methods
Object.freeze(RouteResolver.prototype);
