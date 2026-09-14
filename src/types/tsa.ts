import {
  EnvelopeInput,
  ExpectedSigner,
  MajikSignature,
  MajikSignatureEnvelope,
} from "@majikah/majik-signature";

// to consumers even though the package is a real dependency.
export type {
  MajikTSARequest,
  MajikTimestamp,
  MajikTSAPayload,
} from "@majikah/majik-signature";


/**
 * Represents the gateway-side TSA credit quota available to a caller.
 *
 * This is an API and billing concern only. The quota ledger tracks
 * promotional free stamps and purchased credits and is intentionally
 * not part of the underlying cryptographic library or its signing
 * primitives.
 *
 * Free credits are subject to a daily reset, while paid credits remain
 * available until consumed or otherwise expired according to the
 * gateway's billing policy.
 */
export interface TSAQuota {
  /**
   * Number of free TSA timestamps remaining in the current quota period.
   *
   * This value is decremented when a timestamp operation consumes a
   * free stamp and is replenished when the quota resets.
   */
  free_remaining: number;

  /**
   * Maximum number of free TSA timestamps granted during each quota period.
   *
   * This represents the full free allowance before any stamps are consumed.
   */
  free_daily_limit: number;

  /**
   * Number of purchased TSA timestamp credits currently available.
   *
   * Paid credits are consumed when the request is charged against the
   * purchased-credit balance rather than the free allowance.
   */
  paid_credits: number;

  /**
   * ISO 8601 timestamp indicating when the current free quota period resets.
   *
   * This field describes the next reset boundary for `free_remaining` and
   * does not indicate when paid credits expire.
   */
  resets_at: string;
}





/**
 * Options for signing a file and embedding a trusted timestamp into it.
 */
export interface StampFileOptions {
  /** MIME type of the source file. */
  contentType?: string;

  /** Existing timestamp value to include in the signature flow. */
  timestamp?: string;

  /** MIME type used when re-embedding the signed file. */
  mimeType?: string;

  /** Signers expected to participate in the resulting signature. */
  expectedSigners?: ExpectedSigner[];

  /** Optional validity period for the resulting signature. */
  validUntil?: string;

  /** Optional message associated with the signature chain. */
  message?: string;

  /** Previously signed file used to continue an existing signature chain. */
  priorSignedFile?: Blob;
}

/**
 * Options for signing a file and returning its signature envelope separately
 * instead of embedding the signature back into the file.
 */
export interface StampFileDetachedOptions {
  /** MIME type of the source file. */
  contentType?: string;

  /** Existing timestamp value to include in the signature flow. */
  timestamp?: string;

  /** MIME type associated with the signed file. */
  mimeType?: string;

  /** Signers expected to participate in the resulting signature. */
  expectedSigners?: ExpectedSigner[];

  /** Optional validity period for the resulting signature. */
  validUntil?: string;

  /** Existing detached envelope to extend or update. */
  existingEnvelope?: EnvelopeInput;
}

/**
 * Result returned after signing a file and embedding a trusted timestamp.
 */
export interface StampResult {
  /** Final file containing the updated signature and TSA timestamp. */
  blob: Blob;

  /** Signature created for the file. */
  signature: MajikSignature;

  /** Handler used to process the file format. */
  handler: string;

  /** MIME type of the resulting file. */
  mimeType: string;
}

/**
 * Result returned after signing a file and creating a detached timestamped
 * signature envelope.
 */
export interface StampDetachedResult {
  /** Original or processed file returned by the signing operation. */
  blob: Blob;

  /** Updated detached signature envelope containing the TSA timestamp. */
  envelope: MajikSignatureEnvelope;

  /** Signature created for the file. */
  signature: MajikSignature;

  /** Serialized `.mjksig` representation of the updated envelope. */
  mjksig: Blob;

  /** Handler used to process the file format. */
  handler: string;

  /** MIME type of the resulting file. */
  mimeType: string;
}

/**
 * Options for attaching a trusted timestamp to an existing signature.
 */
export interface TimestampExistingOptions {
  /**
   * Signer ID whose signature should receive the TSA.
   *
   * Required when the file or envelope contains multiple signatures.
   */
  expectedSignerId?: string;

  /** MIME type of the file being processed. */
  mimeType?: string;
}

/**
 * Result returned after attaching a trusted timestamp to an embedded signature.
 */
export interface TimestampExistingResult {
  /** File containing the updated timestamped signature. */
  blob: Blob;

  /** Signature that received the TSA timestamp. */
  signature: MajikSignature;
}

/**
 * Result returned after attaching a trusted timestamp to a detached signature.
 */
export interface TimestampExistingDetachedResult {
  /** Updated detached signature envelope. */
  envelope: MajikSignatureEnvelope;

  /** Signature that received the TSA timestamp. */
  signature: MajikSignature;

  /** Serialized `.mjksig` representation of the updated envelope. */
  mjksig: Blob;
}
