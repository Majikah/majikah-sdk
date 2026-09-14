import type { MajikKey } from "@majikah/majik-key";
import {
  MajikSignature,
  MajikSignatureEnvelope,
  type EnvelopeInput,
  type FileLike,
  type MajikSignatureJSON,
} from "@majikah/majik-signature";

import type { HttpClient } from "../../transport/HttpClient";
import { ValidationError } from "../../errors/ValidationError";
import type {
  MajikTimestamp,
  MajikTSARequest,
  TSAQuota,
  StampDetachedResult,
  StampFileDetachedOptions,
  StampFileOptions,
  StampResult,
  TimestampExistingDetachedResult,
  TimestampExistingOptions,
  TimestampExistingResult,
} from "../../types/tsa";
import { validateTSARequest } from "./validation";
import { resolveTargetSignature } from "../shared/resolve-signature";

/**
 * Client for interacting with the Majikah Time Stamping Authority.
 *
 * Provides low-level TSA requests as well as higher-level helpers for:
 * - requesting timestamps for existing signatures
 * - timestamping already-signed files and envelopes
 * - signing and timestamping files in one operation
 */
export class TSAClient {
  /**
   * Creates a TSA client using the provided HTTP transport.
   *
   * @param http HTTP client used to communicate with the Majikah API.
   */
  constructor(private readonly http: HttpClient) {}

  /**
   * Issues a trusted timestamp request for a TSA payload.
   *
   * @param request TSA request containing the signature hash and related data.
   * @returns The trusted timestamp returned by the TSA.
   */
  async issue(request: MajikTSARequest): Promise<MajikTimestamp> {
    validateTSARequest(request);

    return this.http.request<MajikTimestamp>("tsa", "/timestamp", {
      method: "POST",
      body: request,
    });
  }

  /**
   * Returns the current TSA credit quota for the authenticated caller.
   *
   * @returns The number of available TSA credits and related quota data.
   */
  async quota(): Promise<TSAQuota> {
    const res = await this.http.request<{ tsa_credits: TSAQuota }>(
      "tsa",
      "/quota",
      { method: "GET" },
    );

    return res.tsa_credits;
  }

  /**
   * Requests a trusted timestamp using an existing signature.
   *
   * @param signature Signature instance or serialized signature JSON.
   * @returns The trusted timestamp issued for the signature.
   */
  async issueForSignature(
    signature: MajikSignature | MajikSignatureJSON,
  ): Promise<MajikTimestamp> {
    const sig =
      signature instanceof MajikSignature
        ? signature
        : MajikSignature.fromJSON(signature);

    return this.issue(sig.buildTSARequestPayload());
  }

  /**
   * Attaches a trusted timestamp to an already-signed embedded file.
   *
   * The file must already contain at least one signature. No signing key is
   * required because this method only timestamps an existing signature.
   *
   * @param file Signed file containing one or more signatures.
   * @param options Optional signer and file-processing settings.
   * @returns The file and signature after the TSA has been attached.
   */
  async timestampFile(
    file: FileLike,
    options?: TimestampExistingOptions,
  ): Promise<TimestampExistingResult> {
    const signatures = await MajikSignature.extractFrom(file, {
      mimeType: options?.mimeType,
    });

    const target = resolveTargetSignature(
      signatures,
      options?.expectedSignerId,
      {
        noSignatureHint:
          "Sign the file first, or use stampFile()/stampFileDetached() to sign and timestamp in one call.",
      },
    );

    this.assertNoExistingTSA(target);

    const timestamp = await this.issueForSignature(target);
    target.addTSA(timestamp);

    const blob = await target.embedIn(file, {
      mimeType: options?.mimeType,
    });

    return { blob, signature: target };
  }

  /**
   * Attaches a trusted timestamp to a signature in a detached envelope.
   *
   * The envelope must already contain at least one signature. When multiple
   * signatures are present, `expectedSignerId` identifies which signature
   * receives the TSA.
   *
   * @param envelope Existing detached signature envelope.
   * @param options Optional signer selection and file-processing settings.
   * @returns The updated envelope, signature, and `.mjksig` representation.
   */
  async timestampDetached(
    envelope: EnvelopeInput,
    options?: TimestampExistingOptions,
  ): Promise<TimestampExistingDetachedResult> {
    const env = await MajikSignatureEnvelope.from(envelope);
    const signatures = env.signatures.map((s) => MajikSignature.fromJSON(s));

    const target = resolveTargetSignature(
      signatures,
      options?.expectedSignerId,
      {
        noSignatureHint:
          "Sign the file first, or use stampFile()/stampFileDetached() to sign and timestamp in one call.",
      },
    );
    this.assertNoExistingTSA(target);

    const timestamp = await this.issueForSignature(target);
    target.addTSA(timestamp);

    const nextEnvelope = env.withSignature(target.toJSON());

    return {
      envelope: nextEnvelope,
      signature: target,
      mjksig: nextEnvelope.toMJKSIG(),
    };
  }

  /**
   * Signs a file and attaches a trusted timestamp in one operation.
   *
   * This creates a new signature using the provided MajikKey, requests a TSA
   * timestamp for that signature, and embeds the timestamped signature into
   * the resulting file.
   *
   * @param file File to sign and timestamp.
   * @param key Unlocked MajikKey used to create the signature.
   * @param options Optional signing and file-processing settings.
   * @returns The timestamped file and its signature metadata.
   */
  async stampFile(
    file: FileLike,
    key: MajikKey,
    options?: StampFileOptions,
  ): Promise<StampResult> {
    const { blob, signature, handler, mimeType } =
      await MajikSignature.signFile(file, key, options);

    const timestamp = await this.issueForSignature(signature);
    signature.addTSA(timestamp);

    const finalBlob = await signature.embedIn(blob, { mimeType });

    return {
      blob: finalBlob,
      signature,
      handler,
      mimeType,
    };
  }

  /**
   * Signs a file and returns its trusted timestamp as a detached envelope.
   *
   * Unlike {@link stampFile}, the timestamped signature is not embedded back
   * into the file. The returned envelope can be distributed separately for
   * out-of-band verification.
   *
   * @param file File to sign and timestamp.
   * @param key Unlocked MajikKey used to create the signature.
   * @param options Optional signing and envelope settings.
   * @returns The signed file, updated envelope, signature, and `.mjksig` blob.
   */
  async stampFileDetached(
    file: FileLike,
    key: MajikKey,
    options?: StampFileDetachedOptions,
  ): Promise<StampDetachedResult> {
    const { blob, envelope, signature, handler, mimeType } =
      await MajikSignature.signFileDetached(file, key, options);

    const timestamp = await this.issueForSignature(signature);
    signature.addTSA(timestamp);

    const nextEnvelope = envelope.withSignature(signature.toJSON());

    return {
      blob,
      envelope: nextEnvelope,
      signature,
      mjksig: nextEnvelope.toMJKSIG(),
      handler,
      mimeType,
    };
  }

  /**
   * Prevents a TSA request from being issued for a signature that is already
   * timestamped.
   *
   * This check avoids consuming a TSA credit for an operation that would fail
   * when the timestamp is attached.
   *
   * @param signature Signature that will receive the TSA.
   * @throws ValidationError When the signature already contains a TSA.
   */
  private assertNoExistingTSA(signature: MajikSignature): void {
    if (signature.hasTSA) {
      throw new ValidationError(
        `Signature for signerId "${signature.signerId}" already has a TSA attached — a TSA cannot be replaced once set.`,
        signature.signerId,
      );
    }
  }
}

// Freeze static methods
Object.freeze(TSAClient);

// Freeze instance methods
Object.freeze(TSAClient.prototype);
