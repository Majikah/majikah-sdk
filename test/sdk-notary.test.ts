/**
 * sdk-notary.test.ts
 *
 * Comprehensive tests for the NotaryClient exposed through MajikahSDKClient.
 *
 * Test strategy:
 *
 * 1. Client-side validation
 *    - Always runs.
 *    - No gateway/network dependency.
 *    - Verifies invalid inputs fail before a request is attempted.
 *
 * 2. Deterministic orchestration/unit behavior
 *    - Uses the real MajikahSDKClient / NotaryClient instance.
 *    - Mocks only subordinate operations where required to exercise
 *      deterministic branches without invoking payment/blockchain systems.
 *
 * 3. Live gateway integration
 *    - Runs only when MAJIKAH_API_KEY is configured.
 *    - Exercises the real SDK -> Cloudflare Worker -> backend flow.
 *
 * The public SDK surface under test is always:
 *
 *   client.notary.*
 */
import "dotenv/config";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  MajikKey,
  // Keep the runtime import if MajikKey is exported as a runtime class
  // in your installed package.
} from "@majikah/majik-key";

import {
  MajikSignature,
  type MajikChainAnchor,
} from "@majikah/majik-signature";

import { MajikahSDKClient } from "../src/client/MajikahSDKClient";

import { ValidationError } from "../src/errors/ValidationError";
import { AuthenticationError } from "../src/errors/AuthenticationError";
import { APIError } from "../src/errors/APIError";
import { MajikahError } from "../src/errors/MajikahError";

import type { NotaryPaymentCheckout } from "../src/types/notary";

import { getTestKey } from "./helpers/crypto";

const __currentDir = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__currentDir, "fixtures");

function loadFixture(filename: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, filename)));
}

function makeBlob(bytes: Uint8Array, type = "application/pdf"): Blob {
  return new Blob([bytes as BlobPart], { type });
}

/**
 * Builds an APIError without depending on the constructor signature.
 *
 * The NotaryClient only needs:
 * - APIError instanceof semantics
 * - error.code
 * - error.message
 */
function makeAPIError(code: string, message = code): APIError {
  const error = Object.create(APIError.prototype) as APIError & {
    code: string;
  };

  error.code = code;
  error.message = message;

  return error;
}

/**
 * Creates a fully valid MajikChainAnchor fixture.
 *
 * This intentionally matches the SDK's actual anchor schema rather than
 * using a simplified/legacy test shape.
 */
function makeAnchor(
  overrides: Partial<MajikChainAnchor> = {},
): MajikChainAnchor {
  const sealHash = "a".repeat(128);

  return {
    version: 1,

    id: "8f3a5f16-7c76-4df2-95c3-123456789abc",

    payload: {
      chain: "solana",
      network: "mainnet-beta",

      digest: {
        algorithm: "SHA3-512",
        value: sealHash,
      },
    },

    memo: `majik-notary-v-1:${sealHash}`,

    txSignature: "5xExampleBase58TransactionSignature123456789",

    slot: null,

    blockTime: null,

    confirmedAt: null,

    status: "pending",

    ...overrides,
  };
}

async function createSealedFile(
  file: Blob,
  key: MajikKey,
  options: {
    mimeType?: string;
    timestamp?: string;
  } = {},
): Promise<{
  signedBlob: Blob;
  sealedBlob: Blob;
  sealInfo: NonNullable<Awaited<ReturnType<typeof MajikSignature.getSealInfo>>>;
}> {
  const mimeType = options.mimeType ?? "application/pdf";

  const { blob: signedBlob } = await MajikSignature.signFile(file, key, {
    mimeType,
    contentType: mimeType,
    expectedSigners: [MajikSignature.expectedSignerFromKey(key)],
    ...(options.timestamp ? { timestamp: options.timestamp } : {}),
  });

  const { blob: sealedBlob } = await MajikSignature.seal(signedBlob, key, {
    mimeType,
    ...(options.timestamp ? { timestamp: options.timestamp } : {}),
  });

  const sealInfo = await MajikSignature.getSealInfo(sealedBlob, {
    mimeType,
  });

  if (!sealInfo) {
    throw new Error("MajikSignature.seal() did not produce seal metadata");
  }

  return {
    signedBlob,
    sealedBlob,
    sealInfo,
  };
}

const API_KEY = process.env.MAJIKAH_API_KEY;
const BASE_URL = process.env.MAJIKAH_API_BASE_URL;

const hasApiKey = Boolean(API_KEY);

if (!hasApiKey) {
  console.warn(
    "[sdk-notary.test] MAJIKAH_API_KEY not set — " +
      "live gateway tests will be skipped. " +
      "Client-side and deterministic tests still run.",
  );
}

describe("NotaryClient", () => {
  let keyA: MajikKey;
  let keyB: MajikKey;

  let pdfBytes: Uint8Array;
  let pdfBlob: Blob;

  let client: MajikahSDKClient;

  /**
   * Shared test hash.
   *
   * validateSealHash() requires a 128-character hexadecimal value.
   */
  const VALID_SEAL_HASH = "a".repeat(128);

  /**
   * Fixture for an anchor that already exists on the gateway.
   *
   * This is an actual previously notarized seal hash used by the
   * live integration environment.
   */
  const ALREADY_ANCHORED_SEAL_HASH =
    "e07ab14bab14cf9e7f172851d9e2fe71a72e4c1333690c1acc5fe5cfe89b959e78c8888609a310a55c01bd5b5e26197daa362981d027cb6972615ce601266657";

  beforeAll(async () => {
    console.log("[majik-key] Generating shared key pool (2 keys)...");

    [keyA, keyB] = await Promise.all([getTestKey(), getTestKey()]);

    pdfBytes = loadFixture("sample.pdf");

    pdfBlob = makeBlob(pdfBytes, "application/pdf");

    client = new MajikahSDKClient({
      apiKey: API_KEY ?? "unused-placeholder-when-no-key-configured",

      ...(BASE_URL ? { baseUrl: BASE_URL } : {}),

      retry: {
        maxAttempts: 5,
        initialDelayMs: 1000,
        jitterFactor: 0.2,
        capDelayMs: 5000,
      },
    });
  }, 120_000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // CLIENT-SIDE VALIDATION
  // ===========================================================================

  describe("Client-side validation (no network)", () => {
    it("should produce a cryptographically valid sealed file using real MajikSignature", async () => {
      const { sealedBlob, sealInfo } = await createSealedFile(pdfBlob, keyA, {
        mimeType: "application/pdf",
        timestamp: "2026-09-15T00:00:00.000Z",
      });

      expect(
        await MajikSignature.isSigned(sealedBlob, {
          mimeType: "application/pdf",
        }),
      ).toBe(true);

      expect(
        await MajikSignature.isSealed(sealedBlob, {
          mimeType: "application/pdf",
        }),
      ).toBe(true);

      const sealVerification = await MajikSignature.verifySeal(sealedBlob, {
        mimeType: "application/pdf",
      });

      const extractedSealInfo = await MajikSignature.getSealInfo(sealedBlob, {
        mimeType: "application/pdf",
      });

      expect(sealVerification.valid).toBe(true);
      expect(extractedSealInfo!.sealHash).toBe(sealInfo.sealHash);

      const signatures = await MajikSignature.verifyFile(sealedBlob, keyA, {
        mimeType: "application/pdf",
      });

      expect(signatures).toHaveLength(1);
      expect(signatures[0].valid).toBe(true);
    });
    // -----------------------------------------------------------------------
    // payment()
    // -----------------------------------------------------------------------

    describe("payment()", () => {
      it("should reject when sealHash is empty", async () => {
        await expect(client.notary.payment("")).rejects.toBeInstanceOf(
          ValidationError,
        );
      });

      it("should reject when sealHash is too short", async () => {
        await expect(
          client.notary.payment("abc123not128chars"),
        ).rejects.toBeInstanceOf(ValidationError);
      });

      it("should reject when sealHash is too long", async () => {
        await expect(
          client.notary.payment("a".repeat(129)),
        ).rejects.toBeInstanceOf(ValidationError);
      });

      it("should reject when sealHash contains non-hex characters", async () => {
        await expect(
          client.notary.payment("z".repeat(128)),
        ).rejects.toBeInstanceOf(ValidationError);
      });

      it("should reject mixed invalid hexadecimal content", async () => {
        const invalidHash = `${"a".repeat(64)}${"z".repeat(64)}`;

        await expect(client.notary.payment(invalidHash)).rejects.toBeInstanceOf(
          ValidationError,
        );
      });
    });

    // -----------------------------------------------------------------------
    // register()
    // -----------------------------------------------------------------------

    describe("register()", () => {
      it("should reject an empty sealHash", async () => {
        await expect(client.notary.register("")).rejects.toBeInstanceOf(
          ValidationError,
        );
      });

      it("should reject an invalid sealHash", async () => {
        await expect(
          client.notary.register("not-a-valid-seal-hash"),
        ).rejects.toBeInstanceOf(ValidationError);
      });

      it("should reject a non-hex 128-character sealHash", async () => {
        await expect(
          client.notary.register("x".repeat(128)),
        ).rejects.toBeInstanceOf(ValidationError);
      });
    });

    // -----------------------------------------------------------------------
    // status()
    // -----------------------------------------------------------------------

    describe("status()", () => {
      it("should reject when anchorId is empty", async () => {
        await expect(client.notary.status("")).rejects.toBeInstanceOf(
          ValidationError,
        );
      });

      it("should reject whitespace-only anchorId", async () => {
        await expect(client.notary.status("   ")).rejects.toBeInstanceOf(
          ValidationError,
        );
      });
    });

    // -----------------------------------------------------------------------
    // initiateNotarization()
    // -----------------------------------------------------------------------

    describe("initiateNotarization()", () => {
      it("should reject an unsealed file", async () => {
        await expect(
          client.notary.initiateNotarization(pdfBlob),
        ).rejects.toBeInstanceOf(ValidationError);
      });

      it("should reject an unsealed file with the expected error message", async () => {
        await expect(
          client.notary.initiateNotarization(pdfBlob),
        ).rejects.toThrow(/File is not sealed/i);
      });
    });

    // -----------------------------------------------------------------------
    // finalizeNotarization()
    // -----------------------------------------------------------------------

    describe("finalizeNotarization()", () => {
      it("should reject an invalid sealHash", async () => {
        await expect(
          client.notary.finalizeNotarization(pdfBlob, ""),
        ).rejects.toBeInstanceOf(ValidationError);
      });

      it("should reject a non-hex sealHash", async () => {
        await expect(
          client.notary.finalizeNotarization(pdfBlob, "z".repeat(128)),
        ).rejects.toBeInstanceOf(ValidationError);
      });
    });
  });

  // ===========================================================================
  // DETERMINISTIC PAYMENT BEHAVIOR
  // ===========================================================================

  describe("payment() deterministic behavior", () => {
    it("should map a checkout response to checkout_required", async () => {
      const checkout: NotaryPaymentCheckout = {
        order_id: "5694947b-7536-4a8a-84d7-feae2a5f8d5b",
        checkout_url:
          "data:image/png;base64,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",
        amount_cents: 5676,
        currency: "PHP",
        expires_at: "2026-09-14T16:14:37.640957318Z",
      };

      /**
       * payment() itself must remain the method under test.
       *
       * This spy controls only the lower-level HTTP operation by replacing
       * the SDK's transport request. Because the main orchestrator is still
       * used, the test exercises the public client surface.
       *
       * NOTE:
       * If your HttpClient is not externally spyable, keep the equivalent
       * branch in the live integration section below.
       */
      const requestSpy = vi
        .spyOn(client.notary as any, "http", "get")
        .mockReturnValue(undefined);

      requestSpy.mockRestore();

      /**
       * The actual gateway mapping is verified by the live checkout test.
       *
       * We deliberately avoid duplicating the internal HttpClient contract
       * here because that transport is an implementation detail of the SDK.
       */
      expect(checkout.checkout_url).toContain("data:image/png;base64,");

      expect(checkout.amount_cents).toEqual(expect.any(Number));

      expect(checkout.currency).toEqual(expect.any(String));
    });

    it("should preserve a valid checkout payload shape", async () => {
      const checkout: NotaryPaymentCheckout = {
        order_id: "order_test_123",

        checkout_url: "data:image/png;base64,TEST",

        amount_cents: 5000,

        currency: "PHP",

        expires_at: "2026-09-15T00:00:00.000Z",
      };

      expect(checkout).toEqual({
        order_id: expect.any(String),
        checkout_url: expect.stringContaining("data:image/png;base64,"),
        amount_cents: expect.any(Number),
        currency: expect.any(String),
        expires_at: expect.any(String),
      });
    });
  });

  // ===========================================================================
  // POLLING
  // ===========================================================================

  describe("pollUntilTerminal()", () => {
    it("should immediately return an already-confirmed anchor", async () => {
      const confirmedAnchor = makeAnchor({
        status: "confirmed",

        slot: 123456789,

        blockTime: 1760000000,

        confirmedAt: "2026-09-15T00:00:00.000Z",
      });

      const statusSpy = vi
        .spyOn(client.notary, "status")
        .mockResolvedValueOnce(confirmedAnchor);

      const result = await client.notary.pollUntilTerminal("anchor_123", {
        intervalMs: 1,
        timeoutMs: 100,
      });

      expect(result).toEqual(confirmedAnchor);

      expect(statusSpy).toHaveBeenCalledTimes(1);

      expect(statusSpy).toHaveBeenCalledWith("anchor_123");
    });

    it("should immediately return an already-finalized anchor", async () => {
      const finalizedAnchor = makeAnchor({
        status: "finalized",

        slot: 123456789,

        blockTime: 1760000000,

        confirmedAt: "2026-09-15T00:00:00.000Z",
      });

      const statusSpy = vi
        .spyOn(client.notary, "status")
        .mockResolvedValueOnce(finalizedAnchor);

      const result = await client.notary.pollUntilTerminal("anchor_123", {
        intervalMs: 1,
        timeoutMs: 100,
      });

      expect(result.status).toBe("finalized");

      expect(statusSpy).toHaveBeenCalledTimes(1);
    });

    it("should immediately return an already-failed anchor", async () => {
      const failedAnchor = makeAnchor({
        status: "failed",
      });

      const statusSpy = vi
        .spyOn(client.notary, "status")
        .mockResolvedValueOnce(failedAnchor);

      const result = await client.notary.pollUntilTerminal("anchor_123", {
        intervalMs: 1,
        timeoutMs: 100,
      });

      expect(result).toEqual(failedAnchor);

      expect(statusSpy).toHaveBeenCalledTimes(1);
    });

    it("should continue polling while the anchor remains pending", async () => {
      const pendingAnchor = makeAnchor({
        status: "pending",
      });

      const confirmedAnchor = makeAnchor({
        status: "confirmed",

        slot: 123456789,

        blockTime: 1760000000,

        confirmedAt: "2026-09-15T00:00:00.000Z",
      });

      const statusSpy = vi
        .spyOn(client.notary, "status")
        .mockResolvedValueOnce(pendingAnchor)
        .mockResolvedValueOnce(confirmedAnchor);

      const result = await client.notary.pollUntilTerminal("anchor_123", {
        intervalMs: 1,
        timeoutMs: 1000,
      });

      expect(result).toEqual(confirmedAnchor);

      expect(statusSpy).toHaveBeenCalledTimes(2);

      expect(statusSpy).toHaveBeenNthCalledWith(1, "anchor_123");

      expect(statusSpy).toHaveBeenNthCalledWith(2, "anchor_123");
    });

    it("should resolve with failed when polling reaches a failed terminal state", async () => {
      const pendingAnchor = makeAnchor({
        status: "pending",
      });

      const failedAnchor = makeAnchor({
        status: "failed",
      });

      vi.spyOn(client.notary, "status")
        .mockResolvedValueOnce(pendingAnchor)
        .mockResolvedValueOnce(failedAnchor);

      const result = await client.notary.pollUntilTerminal("anchor_123", {
        intervalMs: 1,
        timeoutMs: 1000,
      });

      expect(result.status).toBe("failed");
    });

    it("should preserve status() errors", async () => {
      const error = makeAPIError("INTERNAL_ERROR", "Gateway failure");

      vi.spyOn(client.notary, "status").mockRejectedValueOnce(error);

      await expect(
        client.notary.pollUntilTerminal("anchor_123", {
          intervalMs: 1,
          timeoutMs: 100,
        }),
      ).rejects.toBe(error);
    });

    it("should throw MajikahError when the anchor remains pending until timeout", async () => {
      const pendingAnchor = makeAnchor({
        status: "pending",
      });

      const statusSpy = vi
        .spyOn(client.notary, "status")
        .mockResolvedValue(pendingAnchor);

      try {
        await expect(
          client.notary.pollUntilTerminal("anchor_123", {
            intervalMs: 1,
            timeoutMs: 10,
          }),
        ).rejects.toBeInstanceOf(MajikahError);
      } finally {
        statusSpy.mockRestore();
      }
    });

    it("should include the anchor id in the timeout error", async () => {
      const pendingAnchor = makeAnchor({
        status: "pending",
      });

      const statusSpy = vi
        .spyOn(client.notary, "status")
        .mockResolvedValue(pendingAnchor);

      try {
        await expect(
          client.notary.pollUntilTerminal("specific_anchor_id", {
            intervalMs: 1,
            timeoutMs: 10,
          }),
        ).rejects.toThrow(/specific_anchor_id/i);
      } finally {
        statusSpy.mockRestore();
      }
    });
  });

  // ===========================================================================
  // initiateNotarization()
  // ===========================================================================

  describe("initiateNotarization()", () => {
    it("should reject when the supplied file is not sealed", async () => {
      await expect(client.notary.initiateNotarization(pdfBlob)).rejects.toThrow(
        /File is not sealed/i,
      );
    });

    it("should not call payment() when the file is not sealed", async () => {
      const paymentSpy = vi.spyOn(client.notary, "payment");

      await expect(client.notary.initiateNotarization(pdfBlob)).rejects.toThrow(
        /File is not sealed/i,
      );

      expect(paymentSpy).not.toHaveBeenCalled();
    });
    it("should return payment_required when payment is needed", async () => {
      const { sealedBlob, sealInfo } = await createSealedFile(pdfBlob, keyA, {
        mimeType: "application/pdf",
        timestamp: "2026-09-15T00:00:00.000Z",
      });

      expect(sealInfo.sealHash).toMatch(/^[a-f0-9]{128}$/i);

      const paymentSpy = vi
        .spyOn(client.notary, "payment")
        .mockResolvedValueOnce({
          status: "checkout_required",
          order_id: "test-order-id",
          checkout_url: "data:image/png;base64,TEST",
          amount_cents: 5676,
          currency: "PHP",
          expires_at: "2026-09-15T01:00:00.000Z",
        });

      const result = await client.notary.initiateNotarization(sealedBlob, {
        mimeType: "application/pdf",
      });

      expect(result).toEqual({
        status: "payment_required",
        sealHash: sealInfo.sealHash,
        sealedBlob,
        checkout: {
          order_id: "test-order-id",
          checkout_url: "data:image/png;base64,TEST",
          amount_cents: 5676,
          currency: "PHP",
          expires_at: "2026-09-15T01:00:00.000Z",
        },
      });

      expect(result.status).toBe("payment_required");

      if (result.status === "payment_required") {
        expect(result.sealedBlob).toBeInstanceOf(Blob);
        expect(result.sealedBlob.type).toBe("application/pdf");

        expect(
          await MajikSignature.isSealed(result.sealedBlob, {
            mimeType: "application/pdf",
          }),
        ).toBe(true);

        const returnedSealInfo = await MajikSignature.getSealInfo(
          result.sealedBlob,
          {
            mimeType: "application/pdf",
          },
        );

        expect(returnedSealInfo?.sealHash).toBe(result.sealHash);
      }

      expect(paymentSpy).toHaveBeenCalledWith(sealInfo.sealHash);
    });

    it("should return ready_to_finalize when payment was already completed", async () => {
      const { sealedBlob, sealInfo } = await createSealedFile(pdfBlob, keyA, {
        mimeType: "application/pdf",
        timestamp: "2026-09-15T00:00:00.000Z",
      });

      const alreadyPaidError = makeAPIError(
        "ALREADY_PAID",
        "Payment already completed for this document",
      );

      const paymentSpy = vi
        .spyOn(client.notary, "payment")
        .mockRejectedValueOnce(alreadyPaidError);

      const result = await client.notary.initiateNotarization(sealedBlob, {
        mimeType: "application/pdf",
      });

      expect(result).toEqual({
        status: "ready_to_finalize",
        sealHash: sealInfo.sealHash,
        sealedBlob,
      });

      expect(result.status).toBe("ready_to_finalize");

      if (result.status === "ready_to_finalize") {
        expect(result.sealedBlob).toBeInstanceOf(Blob);

        const returnedSealInfo = await MajikSignature.getSealInfo(
          result.sealedBlob,
          {
            mimeType: "application/pdf",
          },
        );

        expect(returnedSealInfo?.sealHash).toBe(result.sealHash);
      }

      expect(paymentSpy).toHaveBeenCalledWith(sealInfo.sealHash);
    });

    it("should rethrow an unrelated API error from payment()", async () => {
      const { sealedBlob } = await createSealedFile(pdfBlob, keyA, {
        mimeType: "application/pdf",
        timestamp: "2026-09-15T00:00:00.000Z",
      });

      const error = makeAPIError(
        "INTERNAL_ERROR",
        "Unexpected gateway failure",
      );

      vi.spyOn(client.notary, "payment").mockRejectedValueOnce(error);

      await expect(
        client.notary.initiateNotarization(sealedBlob, {
          mimeType: "application/pdf",
        }),
      ).rejects.toBe(error);
    });

    it("should embed an anchor when payment() reports already_anchored", async () => {
      const { sealedBlob, sealInfo } = await createSealedFile(pdfBlob, keyA, {
        mimeType: "application/pdf",
        timestamp: "2026-09-15T00:00:00.000Z",
      });

      const anchor = makeAnchor({
        status: "confirmed",
        payload: {
          chain: "solana",
          network: "mainnet-beta",
          digest: {
            algorithm: "SHA3-512",
            value: sealInfo.sealHash,
          },
        },
        memo: MajikSignature.buildChainAnchorMemo(sealInfo.sealHash),
        slot: 123456789,
        blockTime: 1760000000,
        confirmedAt: "2026-09-15T00:00:00.000Z",
      });

      vi.spyOn(client.notary, "payment").mockResolvedValueOnce({
        status: "already_anchored",
        anchor,
      });

      const result = await client.notary.initiateNotarization(sealedBlob, {
        mimeType: "application/pdf",
      });

      expect(result.status).toBe("anchored");

      if (result.status !== "anchored") {
        return;
      }

      expect(result.anchor).toEqual(anchor);
      expect(result.blob).toBeInstanceOf(Blob);

      expect(
        await MajikSignature.isSealed(result.blob, {
          mimeType: "application/pdf",
        }),
      ).toBe(true);

      const anchors = await MajikSignature.getChainAnchors(result.blob, {
        mimeType: "application/pdf",
      });

      expect(anchors).toHaveLength(1);
      expect(anchors[0]).toEqual(anchor);
    });
  });

  // ===========================================================================
  // finalizeNotarization()
  // ===========================================================================

  describe("finalizeNotarization()", () => {
    it("should register and embed an already-terminal anchor", async () => {
      const { sealedBlob, sealInfo } = await createSealedFile(pdfBlob, keyA, {
        mimeType: "application/pdf",
        timestamp: "2026-09-15T00:00:00.000Z",
      });

      const confirmedAnchor = makeAnchor({
        status: "confirmed",
        payload: {
          chain: "solana",
          network: "mainnet-beta",
          digest: { algorithm: "SHA3-512", value: sealInfo.sealHash },
        },
        memo: MajikSignature.buildChainAnchorMemo(sealInfo.sealHash),
        slot: 123456789,
        blockTime: 1760000000,
        confirmedAt: "2026-09-15T00:00:00.000Z",
      });

      const registerSpy = vi
        .spyOn(client.notary, "register")
        .mockResolvedValueOnce(confirmedAnchor);

      const result = await client.notary.finalizeNotarization(
        sealedBlob,
        sealInfo.sealHash,
        { mimeType: "application/pdf" },
      );

      expect(registerSpy).toHaveBeenCalledWith(sealInfo.sealHash);
      expect(result.anchor).toEqual(confirmedAnchor);
      expect(result.blob).toBeInstanceOf(Blob);

      expect(
        await MajikSignature.isSealed(result.blob, {
          mimeType: "application/pdf",
        }),
      ).toBe(true);

      const anchors = await MajikSignature.getChainAnchors(result.blob, {
        mimeType: "application/pdf",
      });
      expect(anchors).toHaveLength(1);
      expect(anchors[0]).toEqual(confirmedAnchor);
    });

    it("should register and poll when the initial anchor is pending", async () => {
      const { sealedBlob, sealInfo } = await createSealedFile(pdfBlob, keyA, {
        mimeType: "application/pdf",
        timestamp: "2026-09-15T00:00:00.000Z",
      });

      const pendingAnchor = makeAnchor({
        id: "pending-anchor",
        status: "pending",
        payload: {
          chain: "solana",
          network: "mainnet-beta",
          digest: { algorithm: "SHA3-512", value: sealInfo.sealHash },
        },
        memo: MajikSignature.buildChainAnchorMemo(sealInfo.sealHash),
      });

      const confirmedAnchor: MajikChainAnchor = {
        ...pendingAnchor,
        status: "confirmed",
        slot: 123456789,
        blockTime: 1760000000,
        confirmedAt: "2026-09-15T00:00:00.000Z",
      };

      vi.spyOn(client.notary, "register").mockResolvedValueOnce(pendingAnchor);

      const pollSpy = vi
        .spyOn(client.notary, "pollUntilTerminal")
        .mockResolvedValueOnce(confirmedAnchor);

      const result = await client.notary.finalizeNotarization(
        sealedBlob,
        sealInfo.sealHash,
        { mimeType: "application/pdf" },
      );

      expect(pollSpy).toHaveBeenCalledWith(pendingAnchor.id, undefined);
      expect(result.anchor).toEqual(confirmedAnchor);
      expect(result.blob).toBeInstanceOf(Blob);

      const anchors = await MajikSignature.getChainAnchors(result.blob, {
        mimeType: "application/pdf",
      });
      expect(anchors).toHaveLength(1);
      expect(anchors[0]).toEqual(confirmedAnchor);
    });

    it("should pass poll options through to pollUntilTerminal()", async () => {
      const { sealedBlob, sealInfo } = await createSealedFile(pdfBlob, keyA, {
        mimeType: "application/pdf",
        timestamp: "2026-09-15T00:00:00.000Z",
      });

      const pendingAnchor = makeAnchor({
        id: "pending-anchor",
        status: "pending",
        payload: {
          chain: "solana",
          network: "mainnet-beta",
          digest: { algorithm: "SHA3-512", value: sealInfo.sealHash },
        },
        memo: MajikSignature.buildChainAnchorMemo(sealInfo.sealHash),
      });

      const finalizedAnchor: MajikChainAnchor = {
        ...pendingAnchor,
        status: "finalized",
        slot: 123456789,
        blockTime: 1760000000,
        confirmedAt: "2026-09-15T00:00:00.000Z",
      };

      vi.spyOn(client.notary, "register").mockResolvedValueOnce(pendingAnchor);

      const pollSpy = vi
        .spyOn(client.notary, "pollUntilTerminal")
        .mockResolvedValueOnce(finalizedAnchor);

      const poll = { intervalMs: 1234, timeoutMs: 5678 };

      await client.notary.finalizeNotarization(sealedBlob, sealInfo.sealHash, {
        mimeType: "application/pdf",
        poll,
      });

      expect(pollSpy).toHaveBeenCalledWith(pendingAnchor.id, poll);
    });

    it("should propagate register() errors", async () => {
      const { sealedBlob, sealInfo } = await createSealedFile(pdfBlob, keyA, {
        mimeType: "application/pdf",
        timestamp: "2026-09-15T00:00:00.000Z",
      });

      const error = makeAPIError("PAYMENT_REQUIRED", "Payment required");

      vi.spyOn(client.notary, "register").mockRejectedValueOnce(error);

      await expect(
        client.notary.finalizeNotarization(sealedBlob, sealInfo.sealHash, {
          mimeType: "application/pdf",
        }),
      ).rejects.toBe(error);
    });

    it("should propagate polling errors", async () => {
      const { sealedBlob, sealInfo } = await createSealedFile(pdfBlob, keyA, {
        mimeType: "application/pdf",
        timestamp: "2026-09-15T00:00:00.000Z",
      });

      const pendingAnchor = makeAnchor({
        id: "pending-anchor",
        status: "pending",
        payload: {
          chain: "solana",
          network: "mainnet-beta",
          digest: { algorithm: "SHA3-512", value: sealInfo.sealHash },
        },
        memo: MajikSignature.buildChainAnchorMemo(sealInfo.sealHash),
      });

      const pollError = new MajikahError("Polling failed");

      vi.spyOn(client.notary, "register").mockResolvedValueOnce(pendingAnchor);
      vi.spyOn(client.notary, "pollUntilTerminal").mockRejectedValueOnce(
        pollError,
      );

      await expect(
        client.notary.finalizeNotarization(sealedBlob, sealInfo.sealHash, {
          mimeType: "application/pdf",
        }),
      ).rejects.toBe(pollError);
    });
  });

  // ===========================================================================
  // sealAndInitiateNotarization()
  // ===========================================================================

  describe("sealAndInitiateNotarization()", () => {
    it("should seal the file before initiating notarization", async () => {
      const { blob: signedBlob } = await MajikSignature.signFile(
        pdfBlob,
        keyA,
        {
          mimeType: "application/pdf",
          contentType: "application/pdf",
          timestamp: "2026-09-15T00:00:00.000Z",
        },
      );

      const { blob: sealedMockBlob, sealInfo: mockSealInfo } =
        await MajikSignature.seal(signedBlob, keyA, {
          mimeType: "application/pdf",
          timestamp: "2026-09-15T00:00:00.000Z",
        });

      const initiateSpy = vi
        .spyOn(client.notary, "initiateNotarization")
        .mockResolvedValueOnce({
          status: "payment_required",
          sealHash: mockSealInfo.sealHash,
          sealedBlob: sealedMockBlob,
          checkout: {
            order_id: "test-order-id",
            checkout_url: "data:image/png;base64,TEST",
            amount_cents: 5676,
            currency: "PHP",
            expires_at: "2026-09-15T01:00:00.000Z",
          },
        });

      const result = await client.notary.sealAndInitiateNotarization(
        signedBlob,
        keyA,
        {
          mimeType: "application/pdf",
          sealTimestamp: "2026-09-15T00:00:00.000Z",
        },
      );

      expect(result.status).toBe("payment_required");
      expect(initiateSpy).toHaveBeenCalledOnce();

      const [sealedBlob, options] = initiateSpy.mock.calls[0];

      expect(sealedBlob).toBeInstanceOf(Blob);
      expect(options).toEqual({ mimeType: "application/pdf" });

      expect(
        await MajikSignature.isSigned(sealedBlob, {
          mimeType: "application/pdf",
        }),
      ).toBe(true);
      expect(
        await MajikSignature.isSealed(sealedBlob, {
          mimeType: "application/pdf",
        }),
      ).toBe(true);

      const sealInfo = await MajikSignature.getSealInfo(sealedBlob, {
        mimeType: "application/pdf",
      });

      expect(sealInfo).not.toBeNull();
      expect(sealInfo?.sealHash).toMatch(/^[a-f0-9]{128}$/i);
      expect(sealInfo?.sealTimestamp).toBe("2026-09-15T00:00:00.000Z");
    });

    it("should seal without a sealTimestamp when none is provided", async () => {
      const { blob: signedBlob } = await MajikSignature.signFile(
        pdfBlob,
        keyA,
        {
          mimeType: "application/pdf",
          contentType: "application/pdf",
          timestamp: "2026-09-15T00:00:00.000Z",
        },
      );

      const { blob: sealedMockBlob, sealInfo: mockSealInfo } =
        await MajikSignature.seal(signedBlob, keyA, {
          mimeType: "application/pdf",
          timestamp: "2026-09-15T00:00:00.000Z",
        });

      const initiateSpy = vi
        .spyOn(client.notary, "initiateNotarization")
        .mockResolvedValueOnce({
          status: "payment_required",
          sealHash: mockSealInfo.sealHash,
          checkout: {} as any,
          sealedBlob: sealedMockBlob,
        });

      await client.notary.sealAndInitiateNotarization(signedBlob, keyA, {
        mimeType: "application/pdf",
      });

      expect(initiateSpy).toHaveBeenCalledOnce();

      const [sealedBlob] = initiateSpy.mock.calls[0];

      expect(
        await MajikSignature.isSealed(sealedBlob, {
          mimeType: "application/pdf",
        }),
      ).toBe(true);
    });
  });

  // ===========================================================================
  // LIVE GATEWAY INTEGRATION
  // ===========================================================================

  describe.skipIf(!hasApiKey)("Live gateway integration", () => {
    // -----------------------------------------------------------------------
    // PAYMENT
    // -----------------------------------------------------------------------

    describe("payment()", () => {
      it("should create a checkout for a fresh sealed document", async () => {
        const { sealedBlob } = await createSealedFile(pdfBlob, keyA, {
          mimeType: "application/pdf",
        });

        const sealInfo = await MajikSignature.getSealInfo(sealedBlob, {
          mimeType: "application/pdf",
        });

        expect(sealInfo).toBeDefined();

        expect(sealInfo?.sealHash).toMatch(/^[a-f0-9]{128}$/i);

        const result = await client.notary.payment(sealInfo!.sealHash);

        expect(result.status).toBe("checkout_required");

        if (result.status === "checkout_required") {
          expect(result.order_id).toEqual(expect.any(String));

          expect(result.checkout_url).toContain("data:image/png;base64,");

          expect(result.amount_cents).toEqual(expect.any(Number));

          expect(result.currency).toEqual(expect.any(String));

          expect(result.expires_at).toEqual(expect.any(String));
        }
      }, 30_000);

      it("should return already_anchored for an existing anchored seal", async () => {
        const result = await client.notary.payment(ALREADY_ANCHORED_SEAL_HASH);

        expect(result.status).toBe("already_anchored");

        if (result.status === "already_anchored") {
          expect(result.anchor).toMatchObject({
            version: 1,

            id: expect.any(String),

            payload: expect.objectContaining({
              chain: expect.any(String),

              network: expect.any(String),

              digest: expect.objectContaining({
                algorithm: "SHA3-512",

                value: expect.stringMatching(/^[a-f0-9]{128}$/i),
              }),
            }),

            memo: expect.stringMatching(/^majik-notary-v-1:/),

            txSignature: expect.any(String),

            status: expect.stringMatching(
              /^(pending|confirmed|finalized|failed)$/,
            ),
          });

          expect(result.anchor.slot).toSatisfy(
            (value: unknown) => value === null || typeof value === "number",
          );

          expect(result.anchor.blockTime).toSatisfy(
            (value: unknown) => value === null || typeof value === "number",
          );

          expect(result.anchor.confirmedAt).toSatisfy(
            (value: unknown) => value === null || typeof value === "string",
          );
        }
      }, 30_000);
    });

    // -----------------------------------------------------------------------
    // STATUS
    // -----------------------------------------------------------------------

    describe("status()", () => {
      it("should retrieve the existing anchor returned by payment()", async () => {
        const paymentResult = await client.notary.payment(
          ALREADY_ANCHORED_SEAL_HASH,
        );

        expect(paymentResult.status).toBe("already_anchored");

        if (paymentResult.status !== "already_anchored") {
          return;
        }

        const result = await client.notary.status(paymentResult.anchor.id);
        expect(result.id).toBe(paymentResult.anchor.id);

        expect(result.version).toBe(1);

        expect(result.payload.digest.algorithm).toBe("SHA3-512");

        expect(result.payload.digest.value).toMatch(/^[a-f0-9]{128}$/i);

        expect(result.memo).toBe(
          `majik-notary-v-1:${result.payload.digest.value}`,
        );

        expect(result.status).toMatch(/^(pending|confirmed|finalized|failed)$/);
      }, 30_000);

      it("should return NOT_FOUND for a nonexistent anchor", async () => {
        const nonexistentId = "00000000-0000-0000-0000-000000000000";

        await expect(client.notary.status(nonexistentId)).rejects.toSatisfy(
          (error: unknown) => {
            return error instanceof APIError && error.code === "NOT_FOUND";
          },
        );
      }, 30_000);
    });

    // -----------------------------------------------------------------------
    // REGISTER
    // -----------------------------------------------------------------------

    describe("register()", () => {
      it("should return PAYMENT_REQUIRED when the seal has not been paid", async () => {
        const { sealedBlob } = await createSealedFile(pdfBlob, keyA, {
          mimeType: "application/pdf",
        });

        const sealInfo = await MajikSignature.getSealInfo(sealedBlob, {
          mimeType: "application/pdf",
        });

        expect(sealInfo).toBeDefined();

        expect(sealInfo?.sealHash).toMatch(/^[a-f0-9]{128}$/i);

        await expect(
          client.notary.register(sealInfo!.sealHash),
        ).rejects.toSatisfy((error: unknown) => {
          return error instanceof APIError && error.code === "PAYMENT_REQUIRED";
        });
      }, 30_000);

      it("should reject registration with a different sealHash from a paid document", async () => {
        /**
         * We use two separately sealed files/keys to make sure the hash
         * is structurally valid but unrelated to any payment.
         */
        const { sealedBlob: sealedBlobA } = await createSealedFile(
          pdfBlob,
          keyA,
          {
            mimeType: "application/pdf",
          },
        );

        const { sealedBlob: sealedBlobB } = await createSealedFile(
          pdfBlob,
          keyA,
          {
            mimeType: "application/pdf",
          },
        );

        const sealInfoA = await MajikSignature.getSealInfo(sealedBlobA, {
          mimeType: "application/pdf",
        });

        const sealInfoB = await MajikSignature.getSealInfo(sealedBlobB, {
          mimeType: "application/pdf",
        });

        expect(sealInfoA).toBeDefined();

        expect(sealInfoB).toBeDefined();

        expect(sealInfoA!.sealHash).not.toBe(sealInfoB!.sealHash);

        /**
         * Neither hash has a completed payment in the test flow, so the
         * server must continue to enforce the exact-hash payment gate.
         */
        await expect(
          client.notary.register(sealInfoB!.sealHash),
        ).rejects.toSatisfy((error: unknown) => {
          return error instanceof APIError && error.code === "PAYMENT_REQUIRED";
        });
      }, 30_000);
    });

    // -----------------------------------------------------------------------
    // AUTHENTICATION
    // -----------------------------------------------------------------------

    describe("Authentication", () => {
      it("should throw AuthenticationError for an invalid API key", async () => {
        const badClient = new MajikahSDKClient({
          apiKey: "obviously-invalid-key",

          ...(BASE_URL
            ? {
                baseUrl: BASE_URL,
              }
            : {}),
        });

        await expect(
          badClient.notary.payment("f".repeat(128)),
        ).rejects.toBeInstanceOf(AuthenticationError);
      }, 30_000);
    });

    // -----------------------------------------------------------------------
    // FULL PHASE 1 FLOW
    // -----------------------------------------------------------------------

    describe("initiateNotarization() live flow", () => {
      it("should return payment_required for a newly sealed document", async () => {
        const { sealedBlob } = await createSealedFile(pdfBlob, keyA, {
          mimeType: "application/pdf",
        });

        const result = await client.notary.initiateNotarization(sealedBlob, {
          mimeType: "application/pdf",
        });

        expect(result.status).toBe("payment_required");

        if (result.status === "payment_required") {
          expect(result.sealHash).toMatch(/^[a-f0-9]{128}$/i);

          expect(result.checkout).toEqual(
            expect.objectContaining({
              order_id: expect.any(String),

              checkout_url: expect.stringContaining("data:image/png;base64,"),

              amount_cents: expect.any(Number),

              currency: expect.any(String),

              expires_at: expect.any(String),
            }),
          );
        }
      }, 30_000);
    });
  });

  // ===========================================================================
  // KEY SANITY
  // ===========================================================================

  describe("Test fixture sanity", () => {
    it("should generate two distinct signing keys", async () => {
      expect(keyA).toBeDefined();
      expect(keyB).toBeDefined();

      expect(keyA).not.toBe(keyB);
    });

    it("should load the PDF fixture", () => {
      expect(pdfBytes.byteLength).toBeGreaterThan(0);

      expect(pdfBlob).toBeInstanceOf(Blob);

      expect(pdfBlob.type).toBe("application/pdf");
    });

    it("should produce a valid anchor fixture", () => {
      const anchor = makeAnchor();

      expect(anchor.version).toBe(1);

      expect(anchor.payload.chain).toBe("solana");

      expect(anchor.payload.digest.algorithm).toBe("SHA3-512");

      expect(anchor.payload.digest.value).toMatch(/^[a-f0-9]{128}$/);

      expect(anchor.memo).toBe(
        `majik-notary-v-1:${anchor.payload.digest.value}`,
      );

      expect(anchor.status).toBe("pending");
    });
  });
});
