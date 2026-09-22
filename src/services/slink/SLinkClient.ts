import type { MajikKey } from "@majikah/majik-key";
import { MajikSLink, type MajikSLinkJSON } from "@majikah/majik-slink";

import { HttpClient } from "../../transport/HttpClient";
import { ValidationError } from "../../errors/ValidationError";
import type {
  MajikahClientOptions,
  PageResult,
  PaginationParams,
  PublicKeyResolver,
  RegisterUrlOptions,
  SLinkPublicView,
  SLinkSearchResult,
  VerifiedSLinkMatch,
} from "../../types";

import { normalizeUrl } from "./validation";
import { assertNonEmpty } from "../shared/validation";

/**
 * Client for creating, registering, searching, and verifying Majik SLinks.
 *
 * SLink verification has two distinct stages:
 * - API lookup confirms that a claim exists.
 * - Local cryptographic verification confirms that the claim's signature
 *   is valid using trusted public keys.
 */
export class SLinkClient {
  /**
   * Creates an SLink client using the provided HTTP transport.
   *
   * @param http HTTP client used to communicate with the Majikah API.
   */
  constructor(private readonly http: HttpClient) {}

  /**
   * Initializes a standalone SLink client with its own HTTP transport.
   *
   * This is a convenience method for applications that only require SLink
   * creation, registration, and verification functionality. It automatically
   * provisions the underlying `HttpClient` so you do not have to compose
   * the transport layer manually.
   *
   * By using this initialization method along with subpath exports, you can
   * completely bypass the root `MajikahSDKClient` and safely tree-shake
   * unused cryptographic dependencies from your bundle.
   *
   * @param options SDK configuration and transport options (e.g., API key, base URL, retries).
   * @returns A fully configured `SLinkClient` instance.
   *
   * @example
   * ```ts
   * import { SLinkClient } from "@majikah/sdk/slink";
   *
   * const slink = SLinkClient.init({
   *   apiKey: process.env.MAJIKAH_API_KEY!,
   * });
   *
   * const results = await slink.verifyUrl("example.com");
   * ```
   */
  static init(options: MajikahClientOptions): SLinkClient {
    const http = new HttpClient(options);
    return new SLinkClient(http);
  }

  /**
   * Registers an SLink that has already been created and signed.
   *
   * Accepts either a `MajikSLink` instance or its serialized JSON form.
   *
   * @param slink SLink instance or serialized SLink data.
   * @returns The registered SLink.
   * @throws ValidationError When no SLink is provided.
   */
  async create(slink: MajikSLink | MajikSLinkJSON): Promise<MajikSLinkJSON> {
    if (!slink) {
      throw new ValidationError("slink is required", slink);
    }

    const json = slink instanceof MajikSLink ? slink.toJSON() : slink;

    return this.http.request<MajikSLinkJSON>("slink", "", {
      method: "POST",
      body: json,
    });
  }

  /**
   * Creates, signs, and registers an SLink for a URL in one operation.
   *
   * This is the convenience method for callers that do not already have a
   * `MajikSLink` instance. It requires an unlocked `MajikKey` to sign the
   * claim.
   *
   * @param rawUrl URL or domain to associate with the SLink.
   * @param key Unlocked MajikKey used to sign the SLink.
   * @param userId User identifier recorded as the signer.
   * @param muid MUID associated with the claim.
   * @param options Optional SLink metadata.
   * @returns The registered SLink.
   *
   * @example
   * ```ts
   * const stored = await majikah.slink.registerUrl(
   *   "https://youtube.com/watch?v=dQw4w9WgXcQ",
   *   aliceKey,
   *   userId,
   *   muid,
   * );
   * ```
   */
  async registerUrl(
    rawUrl: string,
    key: MajikKey,
    userId: string,
    muid: string,
    options?: RegisterUrlOptions,
  ): Promise<MajikSLinkJSON> {
    const slink = await MajikSLink.create(rawUrl, key, userId, muid, options);

    return this.create(slink);
  }

  /**
   * Lists SLinks owned by the current API credentials.
   *
   * Results use cursor-based pagination. Pass the returned `next_cursor`
   * directly into the next request's `cursor` parameter.
   *
   * @param params Optional pagination settings.
   * @returns A page of SLinks and pagination metadata.
   */
  async me(params?: PaginationParams): Promise<PageResult<MajikSLinkJSON>> {
    return this.http.request<PageResult<MajikSLinkJSON>>("slink", "/me", {
      method: "GET",
      query: {
        cursor: params?.cursor,
        limit: params?.limit !== undefined ? String(params.limit) : undefined,
      },
    });
  }

  /**
   * Searches for SLink claims associated with a content hash.
   *
   * This confirms which SLink claims exist for the supplied hash but does not
   * perform cryptographic signature verification.
   *
   * @param hash Content hash associated with the SLink claims.
   * @returns Matching SLinks and their public MUID information.
   * @throws ValidationError When the hash is empty.
   */
  async verifyByHash(hash: string): Promise<SLinkSearchResult> {
    assertNonEmpty(hash, "hash");

    return this.http.request<SLinkSearchResult>("slink", "/verify", {
      method: "GET",
      query: { hash },
    });
  }

  /**
   * Searches for SLink claims associated with a URL.
   *
   * Bare domains are automatically normalized to use `https://`.
   * This method confirms that matching claims exist but does not verify their
   * signatures cryptographically.
   *
   * @param url URL or domain associated with the SLink claim.
   * @returns Matching SLinks and their public MUID information.
   *
   * @example
   * ```ts
   * const results = await majikah.slink.verifyUrl("thezelijah.world");
   * ```
   */
  async verifyUrl(url: string): Promise<SLinkSearchResult> {
    const normalized = normalizeUrl(url);

    return this.http.request<SLinkSearchResult>("slink", "/verify", {
      method: "GET",
      query: { url: normalized },
    });
  }

  /**
   * Finds SLink claims for a URL and cryptographically verifies every
   * matching signature locally.
   *
   * The API lookup only establishes that a claim exists for the URL. It does
   * not prove that a signature is valid because SLink public keys are not
   * stored server-side. This method resolves the required public keys through
   * `resolvePublicKeys` and verifies each signature locally.
   *
   * For the common MUID-backed flow, use `createMuidPublicKeyResolver()`.
   * It resolves each signer's public keys through `MUIDClient.lookup()` and
   * converts the API's Base64-encoded keys into the format required for
   * cryptographic verification.
   *
   * @param url URL or domain associated with the SLink claims.
   * @param resolvePublicKeys Callback that resolves trusted public keys for
   * each SLink signer.
   * @returns Each matching SLink paired with its local verification result.
   *
   * @example
   * ```ts
   * import { createMuidPublicKeyResolver } from "@majikah/sdk";
   *
   * const results = await majikah.slink.verifyUrlWithProof(
   *   "thezelijah.world",
   *   createMuidPublicKeyResolver(majikah.muid),
   * );
   *
   * const verified = results.filter(({ result }) => result.valid);
   * ```
   *
   * A custom resolver can be used when public keys come from another trusted
   * registry or key source:
   *
   * @example
   * ```ts
   * const results = await majikah.slink.verifyUrlWithProof(
   *   "thezelijah.world",
   *   async (muid, signerId) => {
   *     const keys = await myKeyRegistry.get(muid);
   *
   *     return {
   *       signerId,
   *       edPublicKey: keys.edPublicKey,
   *       mlDsaPublicKey: keys.mlDsaPublicKey,
   *     };
   *   },
   * );
   * ```
   */
  async verifyUrlWithProof(
    url: string,
    resolvePublicKeys: PublicKeyResolver,
  ): Promise<VerifiedSLinkMatch[]> {
    const { matches } = await this.verifyUrl(url);
    return this.verifyMatches(matches, resolvePublicKeys);
  }

  /**
   * Cryptographically verifies already-fetched SLink search results locally.
   *
   * Use this when the matches were obtained separately through `verifyUrl()`
   * or `verifyByHash()` and you want to verify them without another API lookup.
   *
   * @param matches SLink matches to verify.
   * @param resolvePublicKeys Callback used to obtain trusted public signing keys.
   * @returns Each match paired with its local cryptographic verification result.
   */
  async verifyMatches(
    matches: SLinkPublicView[],
    resolvePublicKeys: PublicKeyResolver,
  ): Promise<VerifiedSLinkMatch[]> {
    const results: VerifiedSLinkMatch[] = [];

    for (const match of matches) {
      const publicKeys = await resolvePublicKeys(
        match.slink.muid,
        match.slink.signature.signerId,
      );

      const result = MajikSLink.verifySignature(match.slink, publicKeys);

      results.push({
        match,
        result,
      });
    }

    return results;
  }

  /**
   * Retrieves an SLink by its identifier.
   *
   * @param id SLink identifier.
   * @returns The SLink together with its owner's public MUID information.
   * @throws ValidationError When the identifier is empty.
   */
  async lookup(id: string): Promise<SLinkPublicView> {
    assertNonEmpty(id, "id");

    return this.http.request<SLinkPublicView>(
      "slink",
      `/${encodeURIComponent(id)}`,
      {
        method: "GET",
      },
    );
  }

  /**
   * Deletes an SLink by its identifier.
   *
   * @param id SLink identifier.
   * @returns The identifier of the deleted SLink.
   * @throws ValidationError When the identifier is empty.
   */
  async delete(id: string): Promise<{ id: string }> {
    assertNonEmpty(id, "id");

    return this.http.request<{ id: string }>(
      "slink",
      `/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
      },
    );
  }
}

Object.freeze(SLinkClient);
Object.freeze(SLinkClient.prototype);
