export type {
  MajikID,
  MajikIDPublicView,
  MajikKeyPublicBundle,
  KeyGenerationRecord,
} from "@majikah/majik-universal-id";

export type { MajikSignatureJSON } from "@majikah/majik-signature";

import type {
  KeyGenerationRecord,
  MajikIDPublicView,
  SignatureTrustLevel,
} from "@majikah/majik-universal-id";
import type { MajikSignatureJSON } from "@majikah/majik-signature";

/**
 * Options for verifying an embedded file signature against a MUID.
 */
export interface VerifyFileOptions {
  /**
   * Signer ID to verify when the file contains multiple signatures.
   *
   * Required for multi-signature files to explicitly identify the target
   * signature.
   */
  expectedSignerId?: string;

  /**
   * MUID to verify the signature against.
   *
   * Accepts either a MUID ID or username. When omitted, the API verifies
   * against the MUID associated with the caller's API key.
   */
  muid?: string;

  /** MIME type of the file being inspected. */
  mimeType?: string;
}

/**
 * Options for verifying a signature from a detached envelope against a MUID.
 */
export interface VerifyFileDetachedOptions {
  /**
   * Signer ID to verify when the envelope contains multiple signatures.
   *
   * Required for multi-signature envelopes to explicitly identify the target
   * signature.
   */
  expectedSignerId?: string;

  /**
   * MUID to verify the signature against.
   *
   * Accepts either a MUID ID or username. When omitted, the API verifies
   * against the MUID associated with the caller's API key.
   */
  muid?: string;
}

/**
 * Request/response shapes for /muid/verify — this exact pairing (an
 * optional id + a signature envelope, returning a trust verdict) only
 * exists as an API contract. Neither library models "verify this over
 * the wire against a resolved identity" as a single object.
 */
export interface MuidVerifyRequestBody {
  id?: string;
  signature: MajikSignatureJSON;
}

export interface MuidVerifyResult {
  valid: boolean;
  trustLevel?: SignatureTrustLevel;
  reason?: string;
  signerId?: string;
  timestamp?: string;
}

/**
 * Projected subset of KeyGenerationRecord returned by /muid/:id/public.
 * Built with Pick against the library type instead of hand-typing the
 * same five fields again — if the library adds/renames a field, this
 * either still compiles (safe) or breaks loudly at the Pick (safe),
 * never silently drifts.
 */
export type PublicKeyGeneration = Pick<
  KeyGenerationRecord,
  "fingerprint" | "bundle_hash" | "status" | "activated_at" | "deactivated_at"
>;

export type PublicSLinkSummary = unknown; // placeholder until SLink ships

/**
 * Composition of a public MUID view + its slinks + key history — this
 * combined shape is purely the /muid/:id/public response contract, not
 * something either library exposes as a single type.
 */
export interface MuidPublicLookupResult {
  muid: MajikIDPublicView;
  slinks: PublicSLinkSummary[];
  key_history: PublicKeyGeneration[];
}
