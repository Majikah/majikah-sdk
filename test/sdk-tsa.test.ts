/**
 * sdk-tsa.test.ts
 *
 * Integration tests for TSAClient — no mocks. Every "live" test below
 * hits the real gateway configured via MAJIKAH_API_BASE_URL (or
 * production if unset) using MAJIKAH_API_KEY from .env.
 *
 * ── Credit budget ─────────────────────────────────────────────────────
 * Each call to issue()/issueForSignature()/stampFile()/stampFileDetached()/
 * timestampFile()/timestampDetached() spends one real TSA credit — the
 * gateway's fail-closed ledger charges on issue regardless of outcome.
 * This suite needs ~7 credits to run every live test once. If your test
 * account is on the free tier (5/day), later tests will self-skip once
 * the ledger runs dry — see ensureCredits() below. Use a staging account
 * with paid test credits, or a base URL pointed at a dedicated test
 * environment, to run the full suite reliably.
 *
 * Client-side validation tests (no network) always run regardless of
 * quota or API key — they exercise error paths that must never reach
 * the network at all.
 */
import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { MajikKey } from "@majikah/majik-key";
import {
  MajikSignature,
  MajikSignatureEnvelope,
} from "@majikah/majik-signature";

import { MajikahSDKClient } from "../src/client/MajikahSDKClient";
import { ValidationError } from "../src/errors/ValidationError";
import { AuthenticationError } from "../src/errors/AuthenticationError";
import { setTimeout } from "node:timers/promises";

// Same helper used in the majik-signature core test suite — copy verbatim
// into this package's test/helpers/crypto.ts.
import { getTestKey } from "./helpers/crypto";
import { TSAQuota } from "../src/types/tsa";

const __currentDir = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__currentDir, "fixtures");

function loadFixture(filename: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, filename)));
}

const API_KEY = process.env.MAJIKAH_API_KEY;
const BASE_URL = process.env.MAJIKAH_API_BASE_URL;
const hasApiKey = !!API_KEY;

if (!hasApiKey) {
  console.warn(
    "[sdk-tsa.test] MAJIKAH_API_KEY not set — skipping live gateway tests. " +
      "Client-side validation tests still run.",
  );
}

describe("TSAClient", () => {
  let keyA: MajikKey;
  let keyB: MajikKey;
  let pdfBytes: Uint8Array;
  let pdfBlob: Blob;
  let client: MajikahSDKClient;

  beforeAll(async () => {
    console.log("[majik-key] Generating shared key pool (2 keys)...");
    [keyA, keyB] = await Promise.all([getTestKey(), getTestKey()]);

    pdfBytes = loadFixture("sample.pdf");
    pdfBlob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });

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

  // ── CLIENT-SIDE VALIDATION (no network calls, always run) ──────────────

  describe("Client-side validation (no network)", () => {
    it("should reject issue() when digest.algorithm is not SHA-256", async () => {
      await expect(
        client.tsa.issue({
          digest: { algorithm: "MD5" as any, value: "irrelevant" },
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("should reject issue() when digest.value is empty", async () => {
      await expect(
        client.tsa.issue({ digest: { algorithm: "SHA-256", value: "" } }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("digest.value format matches MajikSignature's own contentHash (base64 SHA-256, not hex)", async () => {
      const signature = await MajikSignature.sign(pdfBytes, keyA, {
        contentType: "application/pdf",
      });

      // Computed independently of majik-signature's internals — proves
      // the encoding empirically rather than assuming it.
      const expectedBase64 = createHash("sha256")
        .update(pdfBytes)
        .digest("base64");

      expect(signature.contentHash).toBe(expectedBase64);
      expect(signature.buildTSARequestPayload().digest.value).toBe(
        expectedBase64,
      );
    });

    it("timestampFile() should throw when the file has no signatures at all", async () => {
      await expect(client.tsa.timestampFile(pdfBlob)).rejects.toThrow(
        /No signatures found/,
      );
    });

    it("timestampFile() should require expectedSignerId when the file has multiple signers", async () => {
      const { blob: step1 } = await MajikSignature.signFile(pdfBlob, keyA, {
        contentType: "application/pdf",
      });
      const { blob: multiSigned } = await MajikSignature.signFile(step1, keyB, {
        contentType: "application/pdf",
      });

      await expect(client.tsa.timestampFile(multiSigned)).rejects.toThrow(
        /expectedSignerId/,
      );
    });

    it("timestampFile() should throw when expectedSignerId matches no signer", async () => {
      const { blob: signed } = await MajikSignature.signFile(pdfBlob, keyA, {
        contentType: "application/pdf",
      });

      await expect(
        client.tsa.timestampFile(signed, {
          expectedSignerId: "nonexistent-fingerprint",
        }),
      ).rejects.toThrow(/No signature found for signerId/);
    });

    it("timestampDetached() should require expectedSignerId when the envelope has multiple signers", async () => {
      const { blob: stripped1, envelope: env1 } =
        await MajikSignature.signFileDetached(pdfBlob, keyA, {
          contentType: "application/pdf",
        });
      const { blob: stripped2, envelope: env2 } =
        await MajikSignature.signFileDetached(stripped1, keyB, {
          existingEnvelope: env1,
          contentType: "application/pdf",
        });

      await expect(client.tsa.timestampDetached(env2)).rejects.toThrow(
        /expectedSignerId/,
      );
    });
  });

  // ── LIVE GATEWAY INTEGRATION (real network, spends real TSA credits) ────

  describe.skipIf(!hasApiKey)("Live gateway integration", () => {
    beforeAll(async () => {
      const quota = await client.tsa.quota();
      console.log(
        `[sdk-tsa.test] Starting quota — free: ${quota.free_remaining}/${quota.free_daily_limit}, paid: ${quota.paid_credits}`,
      );
    }, 30_000);

    afterAll(async () => {
      const quota = await client.tsa.quota();
      console.log(
        `[sdk-tsa.test] Ending quota — free: ${quota.free_remaining}/${quota.free_daily_limit}, paid: ${quota.paid_credits}`,
      );
    });

    // Add this to clear the 5-request rate limit window between live tests
    afterEach(async () => {
      await setTimeout(2000); // 2-second delay
    });

    let _cachedQuota: TSAQuota | null = null;

    /** Checks live remaining balance and dynamically skips the test if it can't afford `needed` credits. */
    async function ensureCredits(
      skip: () => void,
      needed = 1,
    ): Promise<boolean> {
      if (!_cachedQuota) {
        _cachedQuota = await client.tsa.quota();
      }

      const available =
        (_cachedQuota.free_remaining || 0) + (_cachedQuota.paid_credits || 0);
      if (isNaN(available) || available < needed) {
        console.warn(
          `[sdk-tsa.test] Skipping — needs ${needed} credit(s), only ${available} available.`,
        );
        skip();
        return false;
      }

      // Optimistically deduct the spent credits so subsequent tests have accurate state
      if ((_cachedQuota.free_remaining || 0) >= needed) {
        _cachedQuota.free_remaining -= needed;
      } else {
        _cachedQuota.paid_credits -= needed;
      }

      return true;
    }

    it("quota() returns the current TSA credit snapshot", async () => {
      const quota = await client.tsa.quota();
      expect(typeof quota.free_remaining).toBe("number");
      expect(typeof quota.free_daily_limit).toBe("number");
      expect(typeof quota.paid_credits).toBe("number");
      expect(typeof quota.resets_at).toBe("string");
    });

    it("issue() issues a real trusted timestamp for a manually built request", async ({
      skip,
    }) => {
      if (!(await ensureCredits(skip))) return;

      const signature = await MajikSignature.sign(pdfBytes, keyA, {
        contentType: "application/pdf",
      });

      const timestamp = await client.tsa.issue(
        signature.buildTSARequestPayload(),
      );

      expect(timestamp.version).toBe(1);
      expect(typeof timestamp.id).toBe("string");
      expect(timestamp.payload.digest.value).toBe(signature.contentHash);

      // Prove it's a real, independently-verifiable server signature —
      // not just a well-shaped response — via the same addTSA()/
      // verifyTSA() path a real consumer would use.
      signature.addTSA(timestamp);
      expect(signature.hasTSA).toBe(true);
      expect(signature.verifyTSA().valid).toBe(true);
    }, 30_000);

    it("issueForSignature() builds the request from the signature's own contentHash", async ({
      skip,
    }) => {
      if (!(await ensureCredits(skip))) return;

      const signature = await MajikSignature.sign(pdfBytes, keyB, {
        contentType: "application/pdf",
      });

      const timestamp = await client.tsa.issueForSignature(signature);
      signature.addTSA(timestamp);

      expect(signature.verifyTSA().valid).toBe(true);
    }, 30_000);

    it("stampFile() signs and timestamps an embedded file in one call", async ({
      skip,
    }) => {
      if (!(await ensureCredits(skip))) return;

      const result = await client.tsa.stampFile(pdfBlob, keyA, {
        contentType: "application/pdf",
      });

      expect(result.signature.hasTSA).toBe(true);
      expect(result.signature.verifyTSA().valid).toBe(true);

      const verifyResults = await MajikSignature.verifyFile(result.blob, keyA);
      expect(verifyResults[0].valid).toBe(true);

      const [extracted] = await MajikSignature.extractFrom(result.blob);
      expect(extracted.hasTSA).toBe(true);
    }, 30_000);

    it("stampFileDetached() signs and timestamps, returning a detached envelope + MJKSIG", async ({
      skip,
    }) => {
      if (!(await ensureCredits(skip))) return;

      const result = await client.tsa.stampFileDetached(pdfBlob, keyA, {
        contentType: "application/pdf",
      });

      expect(result.signature.hasTSA).toBe(true);
      expect(result.envelope.signatures[0].tsa).toBeDefined();
      expect(result.mjksig).toBeInstanceOf(Blob);

      const decoded = await MajikSignatureEnvelope.fromMJKSIG(result.mjksig);
      expect(decoded.signatures[0].tsa).toBeDefined();

      const verifyResults = await MajikSignature.verifyFileDetached(
        result.blob,
        result.envelope,
        keyA,
      );
      expect(verifyResults[0].valid).toBe(true);
    }, 30_000);

    it("timestampFile() attaches a TSA to an already-signed embedded file, no key required", async ({
      skip,
    }) => {
      if (!(await ensureCredits(skip))) return;

      const { blob: signedBlob } = await MajikSignature.signFile(
        pdfBlob,
        keyA,
        {
          contentType: "application/pdf",
        },
      );

      const result = await client.tsa.timestampFile(signedBlob);

      expect(result.signature.hasTSA).toBe(true);
      expect(result.signature.verifyTSA().valid).toBe(true);

      const verifyResults = await MajikSignature.verifyFile(result.blob, keyA);
      expect(verifyResults[0].valid).toBe(true);
    }, 30_000);

    // Shared across the next two tests: signed by the disambiguation test,
    // reused by the double-timestamp test to avoid spending an extra credit.
    let multiSigTimestampedBlob: Blob;

    it("timestampFile() disambiguates via expectedSignerId in a multi-sig file", async ({
      skip,
    }) => {
      if (!(await ensureCredits(skip))) return;

      const { blob: step1 } = await MajikSignature.signFile(pdfBlob, keyA, {
        contentType: "application/pdf",
      });
      const { blob: multiSigned } = await MajikSignature.signFile(step1, keyB, {
        contentType: "application/pdf",
      });

      const result = await client.tsa.timestampFile(multiSigned, {
        expectedSignerId: keyB.fingerprint,
      });
      multiSigTimestampedBlob = result.blob;

      const signatures = await MajikSignature.extractFrom(result.blob);
      const sigForA = signatures.find((s) => s.signerId === keyA.fingerprint)!;
      const sigForB = signatures.find((s) => s.signerId === keyB.fingerprint)!;

      expect(sigForA.hasTSA).toBe(false);
      expect(sigForB.hasTSA).toBe(true);
    }, 30_000);

    it("timestampFile() refuses to double-timestamp an already-timestamped signer (no network spent)", async () => {
      // Depends on the previous test having run — if it self-skipped due
      // to insufficient credits, this one has nothing to check against.
      if (!multiSigTimestampedBlob) {
        console.warn(
          "[sdk-tsa.test] Skipping — prior test did not produce a timestamped blob.",
        );
        return;
      }

      // No ensureCredits() guard — assertNoExistingTSA() throws before
      // any network call, so this test costs nothing even at zero balance.
      await expect(
        client.tsa.timestampFile(multiSigTimestampedBlob, {
          expectedSignerId: keyB.fingerprint,
        }),
      ).rejects.toThrow(/already has a TSA attached/);
    });

    it("timestampDetached() attaches a TSA to a detached envelope, no key required", async ({
      skip,
    }) => {
      if (!(await ensureCredits(skip))) return;

      const { blob: stripped, envelope } =
        await MajikSignature.signFileDetached(pdfBlob, keyA, {
          contentType: "application/pdf",
        });

      const result = await client.tsa.timestampDetached(envelope);

      expect(result.envelope.signatures[0].tsa).toBeDefined();

      expect(result.mjksig).toBeInstanceOf(Blob);

      const verifyResults = await MajikSignature.verifyFileDetached(
        stripped,
        result.envelope,
        keyA,
      );
      expect(verifyResults[0].valid).toBe(true);
    }, 30_000);
  });

  // ── ERROR MAPPING AGAINST THE REAL GATEWAY (free — auth fails before quota) ──

  describe.skipIf(!hasApiKey)("Error handling against the real gateway", () => {
    it("should throw AuthenticationError for an invalid API key", async () => {
      const badClient = new MajikahSDKClient({
        apiKey: "obviously-invalid-key",
        ...(BASE_URL ? { baseUrl: BASE_URL } : {}),
      });

      // GET /tsa/v1/quota — the gateway rejects on auth before the TSA
      // ledger is ever consulted, so this doesn't spend a credit even
      // against a technically-valid-shaped key belonging to no one.
      await expect(badClient.tsa.quota()).rejects.toBeInstanceOf(
        AuthenticationError,
      );
    }, 15_000);
  });
});
