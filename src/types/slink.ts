import type { MajikIDPublicView } from "./muid";
import {
  type MajikSLinkJSON,
  type SLinkClaimType,
  type SLinkVerificationMethod,
  type SLinkVerificationStatus,
} from "@majikah/majik-slink";
import type {
  MajikSignerPublicKeys,
  VerificationResult,
} from "@majikah/majik-signature";

export type { MajikSLinkJSON } from "@majikah/majik-slink";

/**
 * Options used when creating and registering an SLink for a URL.
 */
export interface RegisterUrlOptions {
  /** Custom identifier for the SLink. */
  id?: string;

  /** Timestamp to associate with the SLink claim. */
  timestamp?: Date;

  /** Initial verification status of the SLink. */
  status?: SLinkVerificationStatus;

  /** Type of claim represented by the SLink. */
  claimType?: SLinkClaimType;

  /** Method used to verify the SLink claim. */
  verificationMethod?: SLinkVerificationMethod;
}

/**
 * An SLink search match together with the result of local cryptographic
 * verification of its signature.
 */
export interface VerifiedSLinkMatch {
  /** Public SLink and MUID data returned by the API. */
  match: SLinkPublicView;

  /** Result of locally verifying the SLink signature. */
  result: VerificationResult;
}

/**
 * Resolves the public signing keys required to verify an SLink signature.
 *
 * The resolver receives the MUID and signer ID from the SLink and may resolve
 * keys from the MUID API, a local registry, or another trusted source.
 *
 * @param muid MUID associated with the SLink.
 * @param signerId Signer ID recorded in the SLink signature.
 * @returns Public keys required by `MajikSLink.verifySignature()`.
 */
export type PublicKeyResolver = (
  muid: string,
  signerId: string,
) => MajikSignerPublicKeys | Promise<MajikSignerPublicKeys>;

/**
 * Public view of an SLink together with the public identity of its owner.
 */
export interface SLinkPublicView {
  /** Public SLink data. */
  slink: MajikSLinkJSON;

  /** Public MUID information for the SLink owner. */
  muid: MajikIDPublicView;
}

/**
 * Result returned when searching for SLinks by hash.
 */
export interface SLinkSearchResult {
  /** Hash used to identify matching SLinks. */
  hash: string;

  /** SLinks associated with the requested hash. */
  matches: SLinkPublicView[];

  /** Number of matching SLinks returned. */
  count: number;
}
