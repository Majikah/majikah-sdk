import {
  MajikSignature,
  MajikSignatureEnvelope,
  type EnvelopeInput,
  type FileLike,
} from "@majikah/majik-signature";

import type { HttpClient } from "../../transport/HttpClient";
import { ValidationError } from "../../errors/ValidationError";
import { resolveTargetSignature } from "../shared/resolve-signature";
import type {
  MajikIDPublicView,
  MuidPublicLookupResult,
  MuidVerifyRequestBody,
  MuidVerifyResult,
  VerifyFileDetachedOptions,
  VerifyFileOptions,
} from "../../types/muid";

const NO_SIGNATURE_HINT =
  "Sign the file first via @majikah/majik-signature before verifying it against a MUID.";

/**
 * Client for interacting with the Majik Universal ID (MUID) API.
 *
 * Provides direct MUID API operations as well as convenience methods for
 * verifying signatures embedded in files or stored in detached envelopes.
 */
export class MUIDClient {
  /**
   * Creates a MUID client using the provided HTTP transport.
   *
   * @param http HTTP client used to communicate with the Majikah API.
   */
  constructor(private readonly http: HttpClient) {}

  /**
   * Returns the MUID associated with the current API credentials.
   *
   * @returns Public identity information for the authenticated MUID.
   */
  async me(): Promise<MajikIDPublicView> {
    return this.http.request<MajikIDPublicView>("muid", "/me", {
      method: "GET",
    });
  }

  /**
   * Verifies a signature against a MUID.
   *
   * @param body Signature verification request containing the signature and
   * optional MUID identifier.
   * @returns The result of the MUID verification.
   * @throws ValidationError When no signature is provided.
   */
  async verify(body: MuidVerifyRequestBody): Promise<MuidVerifyResult> {
    if (!body?.signature) {
      throw new ValidationError("signature is required", body);
    }

    return this.http.request<MuidVerifyResult>("muid", "/verify", {
      method: "POST",
      body,
    });
  }

  /**
   * Looks up the public MUID associated with an ID or username.
   *
   * @param idOrUsername MUID ID or username to look up.
   * @returns Public MUID information.
   * @throws ValidationError When the identifier is empty.
   */
  async lookup(idOrUsername: string): Promise<MuidPublicLookupResult> {
    if (!idOrUsername) {
      throw new ValidationError("id or username is required", idOrUsername);
    }

    return this.http.request<MuidPublicLookupResult>(
      "muid",
      `/${encodeURIComponent(idOrUsername)}/public`,
      { method: "GET" },
    );
  }

  /**
   * Verifies a signature embedded in a file against a MUID.
   *
   * The file must already contain a Majik Signature. No signing key is
   * required because this method only extracts and verifies an existing
   * signature.
   *
   * When the file contains exactly one signature, it is selected
   * automatically. Multi-signature files require `expectedSignerId` to
   * explicitly select the signature being verified.
   *
   * @param file File containing an embedded Majik Signature.
   * @param options Optional signer, MUID, and MIME type settings.
   * @returns The result of the MUID verification.
   * @throws ValidationError When the file contains no signatures or a
   * requested signer cannot be resolved.
   *
   * @example
   * ```ts
   * const result = await majikah.muid.verifyFile(file);
   * ```
   *
   * @example
   * ```ts
   * const result = await majikah.muid.verifyFile(file, {
   *   expectedSignerId: bobFingerprint,
   *   muid: "bob",
   * });
   * ```
   */
  async verifyFile(
    file: FileLike,
    options?: VerifyFileOptions,
  ): Promise<MuidVerifyResult> {
    const signatures = await MajikSignature.extractFrom(file, {
      mimeType: options?.mimeType,
    });

    const target = resolveTargetSignature(
      signatures,
      options?.expectedSignerId,
      {
        noSignatureHint: NO_SIGNATURE_HINT,
      },
    );

    return this.verify({
      id: options?.muid,
      signature: target.toJSON(),
    });
  }

  /**
   * Verifies a signature contained in a detached envelope against a MUID.
   *
   * The envelope supplies the signature and its content hash. The actual
   * content verification is performed server-side.
   *
   * When the envelope contains exactly one signature, it is selected
   * automatically. Multi-signature envelopes require `expectedSignerId`.
   *
   * @param envelope Detached Majik Signature envelope.
   * @param options Optional signer and MUID settings.
   * @returns The result of the MUID verification.
   * @throws ValidationError When the envelope contains no signatures or a
   * requested signer cannot be resolved.
   *
   * @example
   * ```ts
   * const result = await majikah.muid.verifyFileDetached(envelope, {
   *   muid: "alice",
   * });
   * ```
   */
  async verifyFileDetached(
    envelope: EnvelopeInput,
    options?: VerifyFileDetachedOptions,
  ): Promise<MuidVerifyResult> {
    const env = await MajikSignatureEnvelope.from(envelope);
    const signatures = env.signatures.map((s) => MajikSignature.fromJSON(s));

    const target = resolveTargetSignature(
      signatures,
      options?.expectedSignerId,
      {
        noSignatureHint: NO_SIGNATURE_HINT,
      },
    );

    return this.verify({
      id: options?.muid,
      signature: target.toJSON(),
    });
  }
}

Object.freeze(MUIDClient);
Object.freeze(MUIDClient.prototype);
