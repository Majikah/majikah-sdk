/**
 * sdk-muid.test.ts
 *
 * Integration tests for MUIDClient — no mocks. Every "live" test below
 * hits the real gateway configured via MAJIKAH_API_BASE_URL (or
 * production if unset) using MAJIKAH_API_KEY from .env.
 *
 * Client-side validation tests (no network) always run regardless of
 * quota or API key — they exercise error paths that must never reach
 * the network at all.
 */
import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";

import { MajikKey } from "@majikah/majik-key";
import {
  MajikSignature,
  MajikSignatureEnvelope,
} from "@majikah/majik-signature";

import { MajikahSDKClient } from "../src/client/MajikahSDKClient";
import { ValidationError } from "../src/errors/ValidationError";
import { AuthenticationError } from "../src/errors/AuthenticationError";

import { getTestKey } from "./helpers/crypto";

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
    "[sdk-muid.test] MAJIKAH_API_KEY not set — skipping live gateway tests. " +
      "Client-side validation tests still run.",
  );
}

describe("MUIDClient", () => {
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
    it("should reject verify() when signature is missing", async () => {
      await expect(
        // @ts-expect-error deliberately passing invalid payload
        client.muid.verify({}),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("should reject lookup() when id or username is empty", async () => {
      await expect(client.muid.lookup("")).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it("verifyFile() should throw when the file has no signatures", async () => {
      await expect(client.muid.verifyFile(pdfBlob)).rejects.toThrow(
        /Sign the file first/,
      );
    });

    it("verifyFile() should require expectedSignerId when the file has multiple signatures", async () => {
      const { blob: step1 } = await MajikSignature.signFile(pdfBlob, keyA, {
        contentType: "application/pdf",
      });
      const { blob: multiSigned } = await MajikSignature.signFile(step1, keyB, {
        contentType: "application/pdf",
      });

      await expect(client.muid.verifyFile(multiSigned)).rejects.toThrow(
        /expectedSignerId/,
      );
    });

    it("verifyFileDetached() should require expectedSignerId when the envelope has multiple signers", async () => {
      const { blob: stripped1, envelope: env1 } =
        await MajikSignature.signFileDetached(pdfBlob, keyA, {
          contentType: "application/pdf",
        });
      const { envelope: env2 } = await MajikSignature.signFileDetached(
        stripped1,
        keyB,
        {
          existingEnvelope: env1,
          contentType: "application/pdf",
        },
      );

      await expect(client.muid.verifyFileDetached(env2)).rejects.toThrow(
        /expectedSignerId/,
      );
    });
  });

  // ── LIVE GATEWAY INTEGRATION (real network) ─────────────────────────────

  describe.skipIf(!hasApiKey)("Live gateway integration", () => {
    // Add this to clear the 5-request rate limit window between live tests
    afterEach(async () => {
      await setTimeout(2000);
    });

    let authenticatedMuidId: string | null = null;

    it("me() returns the current authenticated MUID", async () => {
      try {
        const muid = await client.muid.me();

        expect(muid).toBeDefined();
        expect(typeof muid.id).toBe("string");
        expect(muid.id.length).toBeGreaterThan(0);

        authenticatedMuidId = muid.id;
      } catch (err: any) {
        if (err.status === 404) {
          console.warn("[sdk-muid.test] No MUID associated with API key.");
        } else {
          throw err;
        }
      }
    });

    it("lookup() retrieves a public MUID profile by ID", async () => {
      if (!authenticatedMuidId) {
        console.warn(
          "[sdk-muid.test] Skipping lookup() — no MUID ID available.",
        );
        return;
      }

      const result = await client.muid.lookup(authenticatedMuidId);

      expect(result).toBeDefined();
      expect(result.muid).toBeDefined();
      expect(result.muid.id).toBe(authenticatedMuidId);
      expect(Array.isArray(result.slinks)).toBe(true);
      expect(Array.isArray(result.key_history)).toBe(true);
    });

    it("verify() returns false for a signature from an unrelated signer", async () => {
      const signature = await MajikSignature.sign(pdfBytes, keyA, {
        contentType: "application/pdf",
      });

      const result = await client.muid.verify({
        signature: signature.toJSON(),
      });

      expect(result).toBeDefined();
      expect(typeof result.valid).toBe("boolean");
      expect(result.valid).toBe(false);
    }, 15_000);

    it("verifyFile() returns false for an embedded signature from an unrelated signer", async () => {
      const { blob: signedBlob } = await MajikSignature.signFile(
        pdfBlob,
        keyA,
        {
          contentType: "application/pdf",
        },
      );

      const result = await client.muid.verifyFile(signedBlob);

      expect(result).toBeDefined();
      expect(typeof result.valid).toBe("boolean");
      expect(result.valid).toBe(false);
    }, 15_000);

    it("verifyFile() returns true for a file signed by the authenticated MUID", async () => {
      if (!authenticatedMuidId) {
        console.warn(
          "[sdk-muid.test] Skipping self-signed verification — no MUID ID available.",
        );
        return;
      }

      const selfSignedBytes = loadFixture("sample-self.mp4");
      const selfSignedBlob = new Blob([selfSignedBytes as BlobPart], {
        type: "video/mp4",
      });

      const result = await client.muid.verifyFile(selfSignedBlob, {
        muid: authenticatedMuidId,
      });

      expect(result).toBeDefined();
      expect(typeof result.valid).toBe("boolean");
      expect(result.valid).toBe(true);
    }, 15_000);

    it("verifyFile() handles multi-sig files via expectedSignerId", async () => {
      const { blob: step1 } = await MajikSignature.signFile(pdfBlob, keyA, {
        contentType: "application/pdf",
      });

      const { blob: multiSigned } = await MajikSignature.signFile(step1, keyB, {
        contentType: "application/pdf",
      });

      const result = await client.muid.verifyFile(multiSigned, {
        expectedSignerId: keyB.fingerprint,
      });

      expect(result).toBeDefined();
      expect(typeof result.valid).toBe("boolean");
      expect(result.valid).toBe(false);
    }, 15_000);

    it("verifyFileDetached() returns false for an unrelated detached signature", async () => {
      const { envelope } = await MajikSignature.signFileDetached(
        pdfBlob,
        keyA,
        {
          contentType: "application/pdf",
        },
      );

      const result = await client.muid.verifyFileDetached(envelope);

      expect(result).toBeDefined();
      expect(typeof result.valid).toBe("boolean");
      expect(result.valid).toBe(false);
    }, 15_000);
  });

  // ── ERROR MAPPING AGAINST THE REAL GATEWAY ──────────────────────────────

  describe.skipIf(!hasApiKey)("Error handling against the real gateway", () => {
    it("should throw AuthenticationError for an invalid API key", async () => {
      const badClient = new MajikahSDKClient({
        apiKey: "obviously-invalid-key",
        ...(BASE_URL ? { baseUrl: BASE_URL } : {}),
      });

      // GET /muid/v1/me rejects on gateway policy auth immediately
      await expect(badClient.muid.me()).rejects.toBeInstanceOf(
        AuthenticationError,
      );
    }, 15_000);
  });
});
