import {
  MajikSignature,
  MajikSignatureEnvelope,
  type EnvelopeInput,
  type FileLike,
} from "@majikah/majik-signature";

import { HttpClient } from "../../transport/HttpClient";
import { ValidationError } from "../../errors/ValidationError";
import { resolveTargetSignature } from "../shared/resolve-signature";

import type {
  MajikIDPublicView,
  MuidPublicLookupResult,
  MuidVerifyRequestBody,
  MuidVerifyResult,
  VerifyFileDetachedOptions,
  VerifyFileOptions,
  MajikahClientOptions,
} from "../../types";

const NO_SIGNATURE_HINT =
  "Sign the file first via @majikah/majik-signature before verifying it against a MUID.";

/**
 * Normalize an optional user-supplied string identifier.
 *
 * `undefined` means "not supplied" and is preserved.
 * Any supplied value must be a non-empty string after trimming.
 */
function normalizeOptionalIdentifier(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ValidationError(
      `${field} must be a non-empty string when provided.`,
      value,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new ValidationError(
      `${field} must be a non-empty string when provided.`,
      value,
    );
  }

  return normalized;
}

/**
 * Client for the Majik Universal ID (MUID) API.
 *
 * MUID provides:
 * - public identity lookup
 * - authenticated identity lookup
 * - server-side signature verification
 * - embedded-file signature verification
 * - detached-envelope signature verification
 *
 * Important semantic distinction:
 *
 * `expectedSignerId`
 *   Selects which signature inside a multi-signature artifact should be
 *   examined.
 *
 * `muid`
 *   Identifies which MUID the selected signer must belong to.
 *
 * The client never treats `expectedSignerId` as proof of MUID ownership.
 * That binding is performed by the MUID service.
 */
export class MUIDClient {
  constructor(private readonly http: HttpClient) {}

  /**
   * Initialize a standalone MUID client.
   */
  static init(options: MajikahClientOptions): MUIDClient {
    const http = new HttpClient(options);
    return new MUIDClient(http);
  }

  /**
   * Return the MUID associated with the current API credentials.
   */
  async me(): Promise<MajikIDPublicView> {
    return this.http.request<MajikIDPublicView>("muid", "/me", {
      method: "GET",
    });
  }

  /**
   * Verify a signature envelope through the MUID gateway.
   *
   * When `body.id` is supplied, the gateway must verify that the signer
   * belongs to that requested MUID.
   *
   * When `body.id` is omitted, the request preserves the API contract and
   * delegates the gateway's default verification behavior.
   */
  async verify(body: MuidVerifyRequestBody): Promise<MuidVerifyResult> {
    if (
      !body ||
      typeof body !== "object" ||
      !body.signature
    ) {
      throw new ValidationError("signature is required", body);
    }

    const id = normalizeOptionalIdentifier(body.id, "id");

    const requestBody: MuidVerifyRequestBody = {
      signature: body.signature,
      ...(id !== undefined ? { id } : {}),
    };

    return this.http.request<MuidVerifyResult>("muid", "/verify", {
      method: "POST",
      body: requestBody,
    });
  }

  /**
   * Look up a public MUID by ID or username.
   */
  async lookup(idOrUsername: string): Promise<MuidPublicLookupResult> {
    const identifier = normalizeOptionalIdentifier(
      idOrUsername,
      "id or username",
    );

    // normalizeOptionalIdentifier only returns undefined for undefined,
    // while this method's type requires an identifier.
    if (identifier === undefined) {
      throw new ValidationError(
        "id or username is required",
        idOrUsername,
      );
    }

    return this.http.request<MuidPublicLookupResult>(
      "muid",
      `/${encodeURIComponent(identifier)}/public`,
      {
        method: "GET",
      },
    );
  }

  /**
   * Verify a selected signature against an optional MUID.
   *
   * The selected signature is already structurally resolved locally.
   * MUID ownership remains a gateway-side trust decision.
   */
  private verifySelectedSignature(
    signature: MajikSignature,
    muid?: string,
  ): Promise<MuidVerifyResult> {
    const normalizedMuid = normalizeOptionalIdentifier(muid, "muid");

    const body: MuidVerifyRequestBody = {
      signature: signature.toJSON(),
      ...(normalizedMuid !== undefined
        ? { id: normalizedMuid }
        : {}),
    };

    return this.verify(body);
  }

  /**
   * Verify an embedded signature from a file.
   *
   * Selection semantics:
   *
   * - 0 signatures -> ValidationError
   * - 1 signature -> automatically selected
   * - >1 signatures -> expectedSignerId is required
   *
   * Identity semantics:
   *
   * - muid omitted -> gateway default behavior
   * - muid supplied -> selected signer must belong to that MUID
   */
  async verifyFile(
    file: FileLike,
    options?: VerifyFileOptions,
  ): Promise<MuidVerifyResult> {
    const expectedSignerId = normalizeOptionalIdentifier(
      options?.expectedSignerId,
      "expectedSignerId",
    );

    const muid = normalizeOptionalIdentifier(
      options?.muid,
      "muid",
    );

    const signatures = await MajikSignature.extractFrom(file, {
      mimeType: options?.mimeType,
    });

    const target = resolveTargetSignature(
      signatures,
      expectedSignerId,
      {
        noSignatureHint: NO_SIGNATURE_HINT,
      },
    );

    return this.verifySelectedSignature(target, muid);
  }

  /**
   * Verify a detached signature envelope.
   *
   * Selection semantics:
   *
   * - 0 signatures -> ValidationError
   * - 1 signature -> automatically selected
   * - >1 signatures -> expectedSignerId is required
   *
   * The detached envelope is parsed locally first. The selected signature is
   * then sent to the MUID gateway for identity-aware verification.
   */
  async verifyFileDetached(
    envelope: EnvelopeInput,
    options?: VerifyFileDetachedOptions,
  ): Promise<MuidVerifyResult> {
    const expectedSignerId = normalizeOptionalIdentifier(
      options?.expectedSignerId,
      "expectedSignerId",
    );

    const muid = normalizeOptionalIdentifier(
      options?.muid,
      "muid",
    );

    const env = await MajikSignatureEnvelope.from(envelope);

    const signatures = env.signatures.map((signature) =>
      MajikSignature.fromJSON(signature),
    );

    const target = resolveTargetSignature(
      signatures,
      expectedSignerId,
      {
        noSignatureHint: NO_SIGNATURE_HINT,
      },
    );

    return this.verifySelectedSignature(target, muid);
  }
}

Object.freeze(MUIDClient);
Object.freeze(MUIDClient.prototype);