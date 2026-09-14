import { HttpClient } from "../transport/HttpClient";
import { TSAClient } from "../services/tsa/TSAClient";
import { MUIDClient } from "../services/muid/MUIDClient";
import { SLinkClient } from "../services/slink/SLinkClient";
import { NotaryClient } from "../services/notary/NotaryClient";
import type { MajikahClientOptions } from "../types/common";

/**
 * Primary entry point for the Majikah TypeScript SDK.
 *
 * `MajikahSDKClient` composes the SDK's service-specific clients behind a
 * single authenticated transport layer.
 *
 * Each service is exposed through a dedicated namespace:
 *
 * ```ts
 * const majikah = new MajikahSDKClient({
 *   apiKey: process.env.MAJIKAH_API_KEY!,
 * });
 *
 * await majikah.muid.lookup("alice");
 * await majikah.tsa.timestampFile(signedFile);
 * await majikah.slink.verifyUrl("example.com");
 * await majikah.notary.initiateNotarization(sealedFile);
 * ```
 *
 * The root client is intentionally thin. Service-specific functionality
 * belongs to the corresponding client:
 *
 * - {@link MUIDClient} — identity lookup and signature verification
 * - {@link TSAClient} — trusted timestamping
 * - {@link SLinkClient} — signed link registration, lookup, and verification
 * - {@link NotaryClient} — payment-aware on-chain notarization
 *
 * All service clients created by this class share the same underlying
 * {@link HttpClient} instance. This provides a consistent transport and
 * authentication configuration across the SDK while allowing each service to
 * maintain its own public API and domain-specific behavior.
 *
 * ## Architecture
 *
 * ```text
 *                    MajikahSDKClient
 *                           │
 *                    shared HttpClient
 *                           │
 *          ┌────────────────┼────────────────┐
 *          │                │                │
 *          ▼                ▼                ▼
 *        MUID             TSA              SLink
 *          │
 *          └─────────────────────────────────┐
 *                                            ▼
 *                                          Notary
 * ```
 *
 * The root client is responsible for SDK composition and configuration.
 * It does not duplicate service methods or local cryptographic primitives.
 * Operations that belong to a specific service should be accessed through
 * that service's namespace.
 *
 * ## Getting an API key
 *
 * API keys are issued through the Majikah Developer Portal:
 *
 * https://developers.majikah.solutions/early-access
 *
 * To obtain an API key:
 *
 * 1. Create a Majikah account.
 * 2. Create your **Majik Universal ID (MUID)**.
 * 3. Complete the required **KYC verification** for your MUID.
 * 4. Submit the **Early Access application** in the developer portal.
 * 5. Wait for the application to be reviewed and approved by Majikah.
 * 6. After approval, you will receive an email confirmation and gain access
 *    to API key generation in the developer portal.
 *
 * Public API access is currently subject to developer approval. An API key
 * cannot be generated until the Early Access application has been approved.
 *
 * Example:
 *
 * ```ts
 * const majikah = new MajikahSDKClient({
 *   apiKey: process.env.MAJIKAH_API_KEY!,
 * });
 * ```
 *
 * Keep your API key secure. Do not commit it to source control, embed
 * privileged keys in public client bundles, or expose it through logs.
 *
 * ## Authentication
 *
 * The API key supplied through {@link MajikahClientOptions} is shared by the
 * underlying HTTP transport and is automatically applied to authenticated
 * API requests.
 *
 * ```ts
 * const majikah = new MajikahSDKClient({
 *   apiKey: process.env.MAJIKAH_API_KEY!,
 * });
 * ```
 *
 * API keys should be treated as credentials and stored using the runtime's
 * secure secret-management facilities. Do not commit production keys to
 * source control or expose privileged keys in public browser bundles.
 *
 * ## Transport and configuration
 *
 * The constructor accepts the full {@link MajikahClientOptions} configuration,
 * including the API base URL, API version configuration, request timeout,
 * additional headers, retry policy, and optional custom `fetch`
 * implementation.
 *
 * ```ts
 * const majikah = new MajikahSDKClient({
 *   apiKey,
 *   baseUrl: "https://api-public.majikah.solutions",
 *   version: 1,
 *   timeoutMs: 15_000,
 *   retry: {
 *     maxAttempts: 3,
 *     initialDelayMs: 300,
 *     jitterFactor: 0.4,
 *     capDelayMs: 5_000,
 *   },
 * });
 * ```
 *
 * All configured services inherit the same transport configuration unless
 * their own service-level behavior explicitly overrides it.
 *
 * ## Local cryptography
 *
 * `MajikahSDKClient` does not hold or manage application private keys.
 * Signing, sealing, and verification operations that require private
 * cryptographic material are delegated to the corresponding Majikah
 * cryptographic libraries, such as `@majikah/majik-key` and
 * `@majikah/majik-signature`.
 *
 * For example:
 *
 * ```ts
 * const stamped = await majikah.tsa.stampFile(
 *   file,
 *   unlockedKey,
 * );
 * ```
 *
 * The SDK coordinates the service request but does not require private
 * signing keys to be uploaded to the Majikah API.
 *
 * ## Service namespaces
 *
 * ### `muid`
 *
 * {@link MUIDClient} provides identity lookup and signature verification
 * functionality through Majik Universal ID.
 *
 * ```ts
 * const profile = await majikah.muid.lookup("alice");
 * ```
 *
 * ### `tsa`
 *
 * {@link TSAClient} provides trusted timestamping operations.
 *
 * ```ts
 * const result = await majikah.tsa.timestampFile(signedFile);
 * ```
 *
 * ### `slink`
 *
 * {@link SLinkClient} provides signed link registration, lookup,
 * pagination, and cryptographic verification workflows.
 *
 * ```ts
 * const result = await majikah.slink.verifyUrl("example.com");
 * ```
 *
 * ### `notary`
 *
 * {@link NotaryClient} provides payment-aware file notarization and
 * on-chain anchor workflows.
 *
 * ```ts
 * const result =
 *   await majikah.notary.initiateNotarization(sealedFile);
 * ```
 *
 * ## Immutability
 *
 * The client class and its prototype are frozen after definition.
 *
 * Service properties are exposed as `readonly` references so consumers
 * cannot replace the configured service clients through normal TypeScript
 * usage.
 *
 * Freezing the class and prototype helps preserve the SDK's public service
 * topology and prevents accidental mutation of the SDK's core methods at
 * runtime.
 *
 * This does not freeze the internal state of the service clients or prevent
 * normal object-level reflection capabilities provided by the JavaScript
 * runtime.
 *
 * @param options SDK configuration used to initialize the shared HTTP
 * transport and all service clients.
 *
 * @example
 * ```ts
 * import { MajikahSDKClient } from "@majikah/sdk";
 *
 * const majikah = new MajikahSDKClient({
 *   apiKey: process.env.MAJIKAH_API_KEY!,
 * });
 * ```
 *
 * @example
 * ```ts
 * const majikah = new MajikahSDKClient({
 *   apiKey,
 *   version: {
 *     muid: 2,
 *     tsa: 1,
 *     slink: 1,
 *     notary: 1,
 *   },
 *   timeoutMs: 15_000,
 * });
 *
 * const profile = await majikah.muid.lookup("alice");
 * const quota = await majikah.tsa.quota();
 * ```
 *
 * @remarks
 * Create one root client per application integration or logical
 * configuration rather than constructing separate service clients manually.
 * This ensures that all services share the same transport, authentication,
 * retry policy, timeout configuration, and API version strategy.
 */
export class MajikahSDKClient {
  /**
   * Trusted Timestamping Authority service client.
   *
   * Use this namespace for trusted timestamp issuance, timestamping existing
   * signatures, detached timestamp envelopes, and TSA quota operations.
   *
   * @see {@link TSAClient}
   */
  public readonly tsa: TSAClient;

  /**
   * Majik Universal ID service client.
   *
   * Use this namespace for public MUID lookup, authenticated MUID retrieval,
   * and signature verification against MUID identities.
   *
   * @see {@link MUIDClient}
   */
  public readonly muid: MUIDClient;

  /**
   * Signed Link service client.
   *
   * Use this namespace for SLink registration, lookup, pagination, and
   * cryptographic verification workflows.
   *
   * @see {@link SLinkClient}
   */
  public readonly slink: SLinkClient;

  /**
   * File Notarization service client.
   *
   * Use this namespace for payment-aware notarization, seal registration,
   * anchor status, polling, and higher-level seal-and-notarize workflows.
   *
   * @see {@link NotaryClient}
   */
  public readonly notary: NotaryClient;

  /**
   * Creates a configured Majikah SDK client and initializes all public
   * service namespaces over a shared HTTP transport.
   *
   * The supplied options are passed to a single {@link HttpClient} instance,
   * which is then shared by the MUID, TSA, SLink, and Notary clients.
   *
   * This means authentication, base URL, request timeout, retry behavior,
   * custom headers, API versioning, and custom `fetch` behavior are
   * consistently applied across the service clients.
   *
   * @param options SDK client configuration and transport options.
   *
   * @example
   * ```ts
   * const majikah = new MajikahSDKClient({
   *   apiKey: process.env.MAJIKAH_API_KEY!,
   * });
   * ```
   *
   * @example
   * ```ts
   * const majikah = new MajikahSDKClient({
   *   apiKey,
   *   baseUrl: "https://api-public.majikah.solutions",
   *   timeoutMs: 15_000,
   *   version: 1,
   * });
   * ```
   */
  constructor(options: MajikahClientOptions) {
    const http = new HttpClient(options);

    this.tsa = new TSAClient(http);
    this.muid = new MUIDClient(http);
    this.slink = new SLinkClient(http);
    this.notary = new NotaryClient(http);
  }
}

// Freeze static methods
Object.freeze(MajikahSDKClient);

// Freeze instance methods
Object.freeze(MajikahSDKClient.prototype);
