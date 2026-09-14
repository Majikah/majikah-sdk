import type { MajikKey } from "@majikah/majik-key";
import {
  MajikSignature,
  type FileLike,
  type MajikChainAnchor,
} from "@majikah/majik-signature";

import type { HttpClient } from "../../transport/HttpClient";
import { APIError } from "../../errors/APIError";
import { MajikahError } from "../../errors/MajikahError";
import { assertNonEmpty } from "../shared/validation";
import { sleep } from "../shared/sleep";
import type {
  InitiateNotarizationResult,
  NotaryPaymentCheckout,
  NotaryPaymentResult,
  PollOptions,
  SignSealOptions,
} from "../../types/notary";
import { validateSealHash } from "./validation";
import { normalizeToBlob } from "../shared/encoding";

/**
 * Client for notarizing sealed Majik Signature documents on-chain.
 *
 * Notarization uses a two-phase flow:
 *
 * 1. A sealed document is identified by its `sealHash` and payment is
 *    initiated or detected.
 * 2. After payment is complete, the seal is registered on-chain and the
 *    resulting anchor is embedded back into the document.
 *
 * Lower-level methods such as `payment()`, `register()`, and `status()`
 * expose the individual API operations, while the higher-level methods
 * provide complete file-aware workflows.
 */
export class NotaryClient {
  /**
   * Creates a Notary client using the provided HTTP transport.
   *
   * @param http HTTP client used to communicate with the Majikah API.
   */
  constructor(private readonly http: HttpClient) {}

  /**
   * Creates or resumes payment for a sealed document.
   *
   * If the seal has already been anchored, the existing chain anchor is
   * returned and no payment is required.
   *
   * If payment has not yet been completed, the response contains checkout
   * information that can be presented to the user.
   *
   * @param sealHash Unique hash identifying the sealed document.
   * @returns Either an existing chain anchor or payment checkout information.
   * @throws APIError When payment has already been completed for the seal.
   */
  async payment(sealHash: string): Promise<NotaryPaymentResult> {
    validateSealHash(sealHash);
    const raw = await this.http.request<
      { anchor: MajikChainAnchor } | NotaryPaymentCheckout
    >("notary", "/payment", {
      method: "POST",
      body: { sealHash },
    });

    if ("anchor" in raw) {
      return { status: "already_anchored", anchor: raw.anchor };
    }
    return { status: "checkout_required", ...raw };
  }

  /**
   * Submits a paid seal for on-chain notarization.
   *
   * Registration returns immediately. If the anchor is still being confirmed,
   * use {@link status} or {@link pollUntilTerminal} to track its progress.
   *
   * Payment must already be completed for the supplied `sealHash`.
   *
   * @param sealHash Unique hash identifying the paid sealed document.
   * @returns The newly created or existing chain anchor.
   * @throws APIError When no completed payment exists for the seal hash.
   */
  async register(sealHash: string): Promise<MajikChainAnchor> {
    validateSealHash(sealHash);

    return this.http.request<MajikChainAnchor>("notary", "/register", {
      method: "POST",
      body: { sealHash },
    });
  }

  /**
   * Retrieves the current confirmation status of a notarization anchor.
   *
   * @param anchorId Identifier of the chain anchor.
   * @returns The current chain anchor state.
   * @throws ValidationError When the anchor ID is empty.
   */
  async status(anchorId: string): Promise<MajikChainAnchor> {
    assertNonEmpty(anchorId, "anchorId");

    return this.http.request<MajikChainAnchor>(
      "notary",
      `/status/${encodeURIComponent(anchorId)}`,
      {
        method: "GET",
      },
    );
  }

  /**
   * Polls a notarization anchor until it reaches a terminal state.
   *
   * Resolves when the anchor becomes `confirmed`, `finalized`, or `failed`.
   * A failed anchor is returned normally rather than thrown as an exception;
   * callers should inspect `anchor.status` to determine the outcome.
   *
   * @param anchorId Identifier of the chain anchor to monitor.
   * @param options Polling interval and timeout settings.
   * @returns The anchor in its terminal state.
   * @throws MajikahError When the anchor remains pending until the timeout.
   */
  async pollUntilTerminal(
    anchorId: string,
    options?: PollOptions,
  ): Promise<MajikChainAnchor> {
    const interval = options?.intervalMs ?? 2000;
    const timeout = options?.timeoutMs ?? 130_000;
    const start = Date.now();

    for (;;) {
      const anchor = await this.status(anchorId);

      if (anchor.status !== "pending") {
        return anchor;
      }

      if (Date.now() - start >= timeout) {
        throw new MajikahError(
          `Anchor "${anchorId}" did not reach a terminal state within ${timeout}ms (last status: pending). ` +
            `Call status("${anchorId}") again later to check.`,
        );
      }

      await sleep(interval);
    }
  }

  /**
   * Starts the payment-aware notarization flow for an already-sealed file.
   *
   * This method does not wait for payment or blockchain confirmation.
   * Its result tells the caller what action is required next:
   *
   * - `anchored`: The document was already anchored and the returned blob
   *   contains the existing anchor.
   * - `payment_required`: Present the checkout information to the user,
   *   then call {@link finalizeNotarization} after payment completes.
   * - `ready_to_finalize`: Payment was previously completed, so
   *   {@link finalizeNotarization} can be called immediately.
   *
   * @param file Sealed file to notarize.
   * @param options Optional MIME type used when reading and updating the file.
   * @returns The current state of the notarization flow.
   * @throws ValidationError When the file is not sealed.
   *
   * @example
   * ```ts
   * const result = await majikah.notary.initiateNotarization(sealedFile);
   *
   * if (result.status === "payment_required") {
   *   showQrCode(result.checkout.checkout_url);
   *
   *   // After the user completes payment:
   *   const { blob, anchor } =
   *     await majikah.notary.finalizeNotarization(
   *       sealedFile,
   *       result.sealHash,
   *     );
   * }
   * ```
   */
  async initiateNotarization(
    file: FileLike,
    options?: { mimeType?: string },
  ): Promise<InitiateNotarizationResult> {
    const mimeOpt = options?.mimeType
      ? { mimeType: options.mimeType }
      : undefined;

    const sealInfo = await MajikSignature.getSealInfo(file, mimeOpt);

    if (!sealInfo) {
      throw new (await import("../../errors/ValidationError")).ValidationError(
        "File is not sealed — notarization requires a sealed envelope. " +
          "Seal it first via MajikSignature.seal(), or use sealAndInitiateNotarization() / signSealAndInitiateNotarization().",
        file,
      );
    }

    const sealHash = sealInfo.sealHash;

    try {
      const result = await this.payment(sealHash);

      if (result.status === "already_anchored") {
        const blob = await MajikSignature.registerChainAnchor(
          file,
          result.anchor,
          mimeOpt,
        );

        return {
          status: "anchored",
          blob,
          anchor: result.anchor,
        };
      }

      const { status: _drop, ...checkout } = result;

      const sealedBlob = normalizeToBlob(
        file,
        options?.mimeType ?? "application/octet-stream",
      );

      return {
        status: "payment_required",
        sealHash,
        checkout,
        sealedBlob,
      };
    } catch (err) {
      if (err instanceof APIError && err.code === "ALREADY_PAID") {
        const sealedBlob = normalizeToBlob(
          file,
          options?.mimeType ?? "application/octet-stream",
        );
        return {
          status: "ready_to_finalize",
          sealHash,
          sealedBlob,
        };
      }

      throw err;
    }
  }

  /**
   * Completes notarization after payment has been completed.
   *
   * Registers the sealed document's `sealHash`, waits for confirmation when
   * necessary, and embeds the resulting chain anchor back into the file.
   *
   * Call this after {@link initiateNotarization} returns either
   * `payment_required` and the user has paid, or `ready_to_finalize`.
   *
   * @param file Sealed file being notarized.
   * @param sealHash Seal hash returned by {@link initiateNotarization}.
   * @param options MIME type and polling settings.
   * @returns The notarized file and its chain anchor.
   */
  async finalizeNotarization(
    file: FileLike,
    sealHash: string,
    options?: { mimeType?: string; poll?: PollOptions },
  ): Promise<{ blob: Blob; anchor: MajikChainAnchor }> {
    validateSealHash(sealHash);

    let anchor = await this.register(sealHash);

    if (anchor.status === "pending") {
      anchor = await this.pollUntilTerminal(anchor.id, options?.poll);
    }

    const blob = await MajikSignature.registerChainAnchor(
      file,
      anchor,
      options?.mimeType ? { mimeType: options.mimeType } : undefined,
    );

    return {
      blob,
      anchor,
    };
  }

  /**
   * Seals an already-signed file and starts the notarization flow.
   *
   * Use this when all required signers have already signed the document and
   * the issuer is ready to seal the signature envelope and begin payment.
   *
   * @param file Already-signed file.
   * @param issuerKey Unlocked MajikKey belonging to the issuer sealing the file.
   * @param options MIME type and seal timestamp settings.
   * @returns The current state of the notarization flow.
   *
   * @example
   * ```ts
   * const result =
   *   await majikah.notary.sealAndInitiateNotarization(
   *     signedFile,
   *     issuerKey,
   *   );
   * ```
   */
  async sealAndInitiateNotarization(
    file: FileLike,
    issuerKey: MajikKey,
    options?: { mimeType?: string; sealTimestamp?: string },
  ): Promise<InitiateNotarizationResult> {
    const { blob: sealedBlob } = await MajikSignature.seal(file, issuerKey, {
      mimeType: options?.mimeType,
      timestamp: options?.sealTimestamp,
    });

    return this.initiateNotarization(sealedBlob, {
      mimeType: options?.mimeType,
    });
  }

  /**
   * Signs, seals, and starts notarization for a single-signer document.
   *
   * This is the complete convenience flow for documents where the supplied
   * key is the only signer:
   *
   * `sign → seal → initiate notarization`
   *
   * Sealing makes the envelope immutable to further signatures, so this
   * method should not be used when additional signers still need to sign.
   * For multi-signature documents, have all signers sign first and then use
   * {@link sealAndInitiateNotarization}.
   *
   * @param file File to sign and notarize.
   * @param key Unlocked MajikKey used for both signing and sealing.
   * @param options Signing, MIME type, validity, and sealing settings.
   * @returns The current state of the notarization flow.
   *
   * @example
   * ```ts
   * const result =
   *   await majikah.notary.signSealAndInitiateNotarization(
   *     file,
   *     aliceKey,
   *     {
   *       contentType: "application/pdf",
   *     },
   *   );
   * ```
   */
  async signSealAndInitiateNotarization(
    file: FileLike,
    key: MajikKey,
    options?: SignSealOptions,
  ): Promise<InitiateNotarizationResult> {
    const { blob: signedBlob } = await MajikSignature.signFile(file, key, {
      contentType: options?.contentType,
      timestamp: options?.timestamp,
      mimeType: options?.mimeType,
      expectedSigners: options?.expectedSigners,
      validUntil: options?.validUntil,
    });

    return this.sealAndInitiateNotarization(signedBlob, key, {
      mimeType: options?.mimeType,
      sealTimestamp: options?.sealTimestamp,
    });
  }
}

Object.freeze(NotaryClient);
Object.freeze(NotaryClient.prototype);
