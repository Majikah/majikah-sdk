import type {
  ExpectedSigner,
  MajikChainAnchor,
} from "@majikah/majik-signature";

export type { MajikChainAnchor } from "@majikah/majik-signature";

/**
 * Configuration options for polling a pending notarization request.
 *
 * Polling is used by convenience methods that wait for an asynchronously
 * completed notarization or payment flow.
 */
export interface PollOptions {
  /**
   * Time in milliseconds between consecutive status checks.
   *
   * A shorter interval detects state changes sooner but results in more
   * requests to the gateway.
   *
   * @default 2000
   */
  intervalMs?: number;

  /**
   * Maximum time in milliseconds to wait for the operation to complete.
   *
   * The default is slightly longer than the gateway's own pending timeout,
   * allowing the client to observe a confirmation that arrives near the
   * server-side timeout boundary.
   *
   * @default 130000
   */
  timeoutMs?: number;
}

/**
 * Additional options used when creating a cryptographic seal for notarization.
 *
 * These values are incorporated into the signing/sealing process and may
 * affect how the resulting signature is validated.
 */
export interface SignSealOptions {
  /**
   * Content type associated with the payload being sealed.
   *
   * This should describe the logical content being notarized and may be
   * embedded in the generated signature/seal metadata.
   *
   * @example "document"
   */
  contentType?: string;

  /**
   * Timestamp associated with the signature or seal.
   *
   * Expected to be an ISO 8601 timestamp when supplied.
   *
   * @example "2026-09-15T01:30:00.000Z"
   */
  timestamp?: string;

  /**
   * MIME type of the content being notarized.
   *
   * This is typically derived from the original file and is useful when
   * consumers need to preserve or validate the content format.
   *
   * @example "application/pdf"
   */
  mimeType?: string;

  /**
   * Optional list of signers that are expected to participate in the seal.
   *
   * When provided, the resulting signature can be validated against the
   * expected signer set.
   */
  expectedSigners?: ExpectedSigner[];

  /**
   * Timestamp after which the generated signature or seal should no longer
   * be considered valid.
   *
   * Expected to be an ISO 8601 timestamp when supplied.
   *
   * @example "2026-12-31T23:59:59.000Z"
   */
  validUntil?: string;

  /**
   * Timestamp representing when the notarization seal itself was created.
   *
   * Expected to be an ISO 8601 timestamp when supplied.
   *
   * @example "2026-09-15T01:30:00.000Z"
   */
  sealTimestamp?: string;
}

/**
 * Payment checkout information returned by the notarization payment service.
 *
 * This payload contains everything required for a client to present the
 * payment checkout to a user and track its expiration.
 */
export interface NotaryPaymentCheckout {
  /**
   * Unique payment order identifier assigned by the payment service.
   *
   * Use this identifier when referring to the associated payment transaction.
   */
  order_id: string;

  /**
   * Data URL containing the QR code for checkout.
   *
   * The value is formatted as a `data:image/png;base64,...` URL and can be
   * supplied directly to an HTML `<img src>` attribute.
   *
   * @example "data:image/png;base64,..."
   */
  checkout_url: string;

  /**
   * Payment amount expressed in the smallest unit of the currency.
   *
   * For example, `5000` with `currency: "PHP"` represents ₱50.00.
   */
  amount_cents: number;

  /**
   * ISO 4217 currency code used for the payment.
   *
   * @example "PHP"
   */
  currency: string;

  /**
   * ISO 8601 timestamp indicating when the checkout expires.
   *
   * Clients should avoid presenting an expired checkout to users.
   *
   * @example "2026-09-15T02:00:00.000Z"
   */
  expires_at: string;
}

/**
 * Response returned by `POST /notary/v1/payment`.
 *
 * The result is a discriminated union:
 *
 * - `already_anchored` means the document has already been notarized and no
 *   payment is required.
 * - `checkout_required` means payment must be completed before notarization
 *   can be finalized.
 *
 * The server removes its internal `outcome` discriminant before returning
 * the response, so the client determines the variant from the response
 * `status`.
 */
export type NotaryPaymentResult =
  /**
   * The document is already anchored on the notarization chain.
   *
   * No additional payment or notarization step is required.
   */
  | {
      /** Indicates that the document is already notarized. */
      status: "already_anchored";

      /** Existing blockchain/notarization chain anchor. */
      anchor: MajikChainAnchor;
    }

  /**
   * Payment is required before the notarization can be finalized.
   *
   * Includes the payment checkout information needed to continue the flow.
   */
  | ({
      /** Indicates that the caller must complete the checkout flow. */
      status: "checkout_required";
    } & NotaryPaymentCheckout);

/**
 * Result returned by the two-phase `initiateNotarization()` convenience flow.
 *
 * This discriminated union represents the complete set of states that can
 * occur while preparing a notarization:
 *
 * - `anchored`: the document was already notarized and the existing anchor
 *   is available.
 * - `payment_required`: payment must be completed before finalization.
 * - `ready_to_finalize`: payment is complete or not required and the caller
 *   can proceed with finalization.
 */
export type InitiateNotarizationResult =
  /**
   * The document is already notarized.
   *
   * The returned blob contains the resulting notarization artifact and
   * `anchor` contains the existing chain anchor.
   */
  | {
      /** Indicates that notarization has already been completed. */
      status: "anchored";

      /** Resulting notarized artifact. */
      blob: Blob;

      /** Existing notarization chain anchor. */
      anchor: MajikChainAnchor;
    }

  /**
   * Payment is required before notarization can proceed.
   *
   * The sealed artifact is returned unchanged so the caller can retain it
   * while the payment is completed. The same artifact should be supplied to
   * `finalizeNotarization()` together with `sealHash`.
   */
  | {
      /** Indicates that payment must be completed before finalization. */
      status: "payment_required";

      /**
       * SHA-256-derived seal hash identifying this sealed notarization
       * payload.
       *
       * Pass this value to `finalizeNotarization()` after payment succeeds.
       */
      sealHash: string;

      /**
       * The sealed artifact associated with `sealHash`.
       *
       * This is returned before payment so the caller can retain the exact
       * sealed file that will later receive the chain anchor.
       */
      sealedBlob: Blob;

      /** Checkout information required to complete payment. */
      checkout: NotaryPaymentCheckout;
    }

  /**
   * The notarization request is ready for finalization.
   *
   * Payment has already been completed. The returned `sealedBlob` and
   * `sealHash` can be passed directly to `finalizeNotarization()`.
   */
  | {
      /** Payment has already been completed, so the returned
  sealed artifact can be finalized immediately. */
      status: "ready_to_finalize";

      /**
       * SHA-256-derived seal hash identifying the notarization payload.
       *
       * Pass this value to the finalization step.
       */
      sealHash: string;

      /**
       * The sealed artifact associated with `sealHash`.
       *
       * This is returned before payment so the caller can retain the exact
       * sealed file that will later receive the chain anchor.
       */
      sealedBlob: Blob;
    };
