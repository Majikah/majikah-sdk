import "dotenv/config";

import { beforeAll, describe, expect, it, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MajikKey } from "@majikah/majik-key";
import { MajikSignature } from "@majikah/majik-signature";

import { MajikahSDKClient } from "../src";
import { AuthenticationError, ValidationError } from "../src/errors";

import { generateTestKey, getTestKey } from "./helpers/crypto";

// ============================================================================
// TEST CONFIG
// ============================================================================

const API_KEY = process.env.MAJIKAH_API_KEY;
const BASE_URL = process.env.MAJIKAH_API_BASE_URL;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// FIXTURES
// ============================================================================

function loadFixture(filename: string): Uint8Array {
  const filePath = resolve(__dirname, "fixtures", filename);
  return new Uint8Array(readFileSync(filePath));
}

// ============================================================================
// HELPERS
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// SUITE
// ============================================================================

describe("MUIDClient", () => {
  let keyA: MajikKey;
  let keyB: MajikKey;

  let pdfBytes: Uint8Array;
  let pdfBlob: Blob;

  let client: MajikahSDKClient;
  let localClient: MajikahSDKClient;

  // --------------------------------------------------------------------------
  // Reusable signed fixtures
  // --------------------------------------------------------------------------

  let signedByA: Blob;
  let multiSigned: Blob;

  let detachedBlob: Blob;
  let detachedEnvelopeSingle: Awaited<
    ReturnType<typeof MajikSignature.signFileDetached>
  >["envelope"];

  let detachedEnvelopeMulti: Awaited<
    ReturnType<typeof MajikSignature.signFileDetached>
  >["envelope"];

  // --------------------------------------------------------------------------
  // Shared setup
  // --------------------------------------------------------------------------

  beforeAll(async () => {
    console.log("[majik-key] Generating shared key pool (2 keys)...");

    [keyA, keyB] = await Promise.all([getTestKey(), generateTestKey()]);

    // Critical invariant for multisig tests.
    expect(keyA.fingerprint).not.toBe(keyB.fingerprint);
    expect(keyA.getKeypair("classic:ed25519").publicBase64).not.toBe(
      keyB.getKeypair("classic:ed25519").publicBase64,
    );

    console.log("[majik-key] keyA:", keyA.fingerprint);
    console.log("[majik-key] keyB:", keyB.fingerprint);

    pdfBytes = loadFixture("sample.pdf");
    pdfBlob = new Blob([pdfBytes as BlobPart], {
      type: "application/pdf",
    });

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

    // Used only for validation-path tests.
    //
    // There are intentionally no mocks here. If a local validation test
    // accidentally reaches the gateway, this client should fail with
    // AuthenticationError rather than ValidationError.
    localClient = new MajikahSDKClient({
      apiKey: "definitely-invalid-local-validation-key",
      ...(BASE_URL ? { baseUrl: BASE_URL } : {}),
      retry: {
        maxAttempts: 1,
        initialDelayMs: 0,
        jitterFactor: 0,
        capDelayMs: 0,
      },
    });

    // ------------------------------------------------------------------------
    // Embedded signature: signer A
    // ------------------------------------------------------------------------

    const firstSigned = await MajikSignature.signFile(pdfBlob, keyA, {
      contentType: "application/pdf",
    });

    signedByA = firstSigned.blob;

    // ------------------------------------------------------------------------
    // Embedded multisig: signer A + signer B
    // ------------------------------------------------------------------------

    const secondSigned = await MajikSignature.signFile(signedByA, keyB, {
      contentType: "application/pdf",
    });

    multiSigned = secondSigned.blob;

    // Verify that the fixture is genuinely multisignature before any
    // MUIDClient tests depend on it.
    const embeddedSignatures = await MajikSignature.extractFrom(multiSigned);

    expect(embeddedSignatures).toHaveLength(2);
    expect(
      new Set(embeddedSignatures.map((signature) => signature.signerId)).size,
    ).toBe(2);

    expect(embeddedSignatures.map((signature) => signature.signerId)).toEqual(
      expect.arrayContaining([keyA.fingerprint, keyB.fingerprint]),
    );

    // ------------------------------------------------------------------------
    // Detached signature: signer A
    // ------------------------------------------------------------------------

    const firstDetached = await MajikSignature.signFileDetached(pdfBlob, keyA, {
      contentType: "application/pdf",
    });

    detachedBlob = firstDetached.blob;
    detachedEnvelopeSingle = firstDetached.envelope;

    expect(detachedEnvelopeSingle.signatures).toHaveLength(1);
    expect(detachedEnvelopeSingle.signatures[0]?.signerId).toBe(
      keyA.fingerprint,
    );

    // ------------------------------------------------------------------------
    // Detached multisig: signer A + signer B
    // ------------------------------------------------------------------------

    const secondDetached = await MajikSignature.signFileDetached(
      detachedBlob,
      keyB,
      {
        existingEnvelope: detachedEnvelopeSingle,
        contentType: "application/pdf",
      },
    );

    detachedEnvelopeMulti = secondDetached.envelope;

    expect(detachedEnvelopeMulti.signatures).toHaveLength(2);
    expect(
      new Set(
        detachedEnvelopeMulti.signatures.map((signature) => signature.signerId),
      ).size,
    ).toBe(2);

    expect(
      detachedEnvelopeMulti.signatures.map((signature) => signature.signerId),
    ).toEqual(expect.arrayContaining([keyA.fingerprint, keyB.fingerprint]));

    console.log(
      "[majik-signature] Embedded signers:",
      embeddedSignatures.map((signature) => signature.signerId),
    );

    console.log(
      "[majik-signature] Detached signers:",
      detachedEnvelopeMulti.signatures.map((signature) => signature.signerId),
    );
  }, 120_000);

  // ==========================================================================
  // CLIENT-SIDE VALIDATION
  //
  // These tests must not make a successful gateway request.
  // We use an intentionally invalid API key instead of mocking the HTTP layer.
  // ==========================================================================

  describe("Client-side validation (no network)", () => {
    it("verify() should reject when signature is missing", async () => {
      await expect(
        localClient.muid.verify({
          id: undefined,
          signature: undefined,
        } as never),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("lookup() should reject when id or username is empty", async () => {
      await expect(localClient.muid.lookup("")).rejects.toBeInstanceOf(
        ValidationError,
      );

      await expect(localClient.muid.lookup("   ")).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it("verifyFile() should reject when the file has no signatures", async () => {
      await expect(localClient.muid.verifyFile(pdfBlob)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it("verifyFile() should require expectedSignerId for multiple signatures", async () => {
      const signatures = await MajikSignature.extractFrom(multiSigned);

      expect(signatures).toHaveLength(2);

      await expect(localClient.muid.verifyFile(multiSigned)).rejects.toThrow(
        /expectedSignerId/i,
      );
    });

    it("verifyFileDetached() should require expectedSignerId for multiple signers", async () => {
      expect(detachedEnvelopeMulti.signatures).toHaveLength(2);

      await expect(
        localClient.muid.verifyFileDetached(detachedEnvelopeMulti),
      ).rejects.toThrow(/expectedSignerId/i);
    });

    it("verifyFile() should reject an unknown expectedSignerId", async () => {
      await expect(
        localClient.muid.verifyFile(multiSigned, {
          expectedSignerId: "not-a-real-signer-id",
        }),
      ).rejects.toThrow(/signer/i);
    });

    it("verifyFileDetached() should reject an unknown expectedSignerId", async () => {
      await expect(
        localClient.muid.verifyFileDetached(detachedEnvelopeMulti, {
          expectedSignerId: "not-a-real-signer-id",
        }),
      ).rejects.toThrow(/signer/i);
    });

    it("verifyFile() should allow selecting signer A from a multisignature file", async () => {
      await expect(
        localClient.muid.verifyFile(multiSigned, {
          expectedSignerId: keyA.fingerprint,
        }),
      ).rejects.toBeInstanceOf(AuthenticationError);
    });

    it("verifyFileDetached() should allow selecting signer B from a multisignature envelope", async () => {
      await expect(
        localClient.muid.verifyFileDetached(detachedEnvelopeMulti, {
          expectedSignerId: keyB.fingerprint,
        }),
      ).rejects.toBeInstanceOf(AuthenticationError);
    });
  });

  // ==========================================================================
  // LIVE GATEWAY INTEGRATION
  // ==========================================================================

  describe.skipIf(!API_KEY)("Live gateway integration", () => {
    // --------------------------------------------------------------------------
    // me()
    // --------------------------------------------------------------------------

    it("me() returns the current authenticated MUID", async () => {
      const me = await client.muid.me();

      expect(me).toBeDefined();
      expect(me.id).toBeDefined();
      expect(typeof me.id).toBe("string");
      expect(me.id.length).toBeGreaterThan(0);
    });

    // --------------------------------------------------------------------------
    // lookup()
    // --------------------------------------------------------------------------

    it("lookup() retrieves the authenticated MUID", async () => {
      const me = await client.muid.me();

      expect(me.id).toBeTruthy();

      const result = await client.muid.lookup(me.id);

      expect(result).toBeDefined();
      expect(result.muid.id).toBe(me.id);
    });

    // --------------------------------------------------------------------------
    // verify()
    //
    // keyA comes from _key/_self.json, therefore it is expected to belong to
    // the authenticated MUID.
    // --------------------------------------------------------------------------

    it("verify() returns true for the authenticated MUID's registered signer", async () => {
      const me = await client.muid.me();

      const signatures = await MajikSignature.extractFrom(signedByA);

      expect(signatures).toHaveLength(1);

      const signature = signatures[0];

      expect(signature).toBeDefined();
      expect(signature!.signerId).toBe(keyA.fingerprint);

      const result = await client.muid.verify({
        id: me.id,
        signature: signature!.toJSON(),
      });

      expect(result).toBeDefined();
      expect(result.signerId).toBe(keyA.fingerprint);
      expect(result.valid).toBe(true);
    });

    // --------------------------------------------------------------------------
    // verify()
    //
    // keyB is freshly generated and is NOT registered to the authenticated MUID.
    // --------------------------------------------------------------------------

    it("verify() returns false for an unrelated signer", async () => {
      const me = await client.muid.me();

      const signatures = await MajikSignature.extractFrom(
        await MajikSignature.signFile(pdfBlob, keyB, {
          contentType: "application/pdf",
        }).then((result) => result.blob),
      );

      expect(signatures).toHaveLength(1);

      const signature = signatures[0];

      expect(signature).toBeDefined();
      expect(signature!.signerId).toBe(keyB.fingerprint);

      const result = await client.muid.verify({
        id: me.id,
        signature: signature!.toJSON(),
      });

      expect(result).toBeDefined();
      expect(result.signerId).toBe(keyB.fingerprint);
      expect(result.valid).toBe(false);
    });

    // --------------------------------------------------------------------------
    // verifyFile()
    // --------------------------------------------------------------------------

    it("verifyFile() returns true for the authenticated MUID's signer", async () => {
      const me = await client.muid.me();

      const result = await client.muid.verifyFile(signedByA, {
        muid: me.id,
      });

      expect(result).toBeDefined();
      expect(result.signerId).toBe(keyA.fingerprint);
      expect(result.valid).toBe(true);
    });

    it("verifyFile() returns false for an unrelated signer", async () => {
      const me = await client.muid.me();

      const unrelatedSigned = await MajikSignature.signFile(pdfBlob, keyB, {
        contentType: "application/pdf",
      });

      const result = await client.muid.verifyFile(unrelatedSigned.blob, {
        muid: me.id,
      });

      expect(result).toBeDefined();
      expect(result.signerId).toBe(keyB.fingerprint);
      expect(result.valid).toBe(false);
    });

    // --------------------------------------------------------------------------
    // verifyFile() multisig
    //
    // keyA = trusted / registered
    // keyB = unrelated / unregistered
    // --------------------------------------------------------------------------

    it("verifyFile() selects the authenticated signer in a multisignature file", async () => {
      const me = await client.muid.me();

      const result = await client.muid.verifyFile(multiSigned, {
        muid: me.id,
        expectedSignerId: keyA.fingerprint,
      });

      expect(result).toBeDefined();
      expect(result.signerId).toBe(keyA.fingerprint);
      expect(result.valid).toBe(true);
    });

    it("verifyFile() selects the unrelated signer in a multisignature file and returns false", async () => {
      const me = await client.muid.me();

      const result = await client.muid.verifyFile(multiSigned, {
        muid: me.id,
        expectedSignerId: keyB.fingerprint,
      });

      expect(result).toBeDefined();
      expect(result.signerId).toBe(keyB.fingerprint);
      expect(result.valid).toBe(false);
    });

    // --------------------------------------------------------------------------
    // verifyFileDetached()
    // --------------------------------------------------------------------------

    it("verifyFileDetached() returns true for the authenticated signer", async () => {
      const me = await client.muid.me();

      expect(detachedEnvelopeSingle.signatures).toHaveLength(1);
      expect(detachedEnvelopeSingle.signatures[0]?.signerId).toBe(
        keyA.fingerprint,
      );

      const result = await client.muid.verifyFileDetached(
        detachedEnvelopeSingle,
        {
          muid: me.id,
        },
      );

      expect(result).toBeDefined();
      expect(result.signerId).toBe(keyA.fingerprint);
      expect(result.valid).toBe(true);
    });

    it("verifyFileDetached() returns false for an unrelated signer", async () => {
      const me = await client.muid.me();

      const unrelatedDetached = await MajikSignature.signFileDetached(
        pdfBlob,
        keyB,
        {
          contentType: "application/pdf",
        },
      );

      expect(unrelatedDetached.envelope.signatures).toHaveLength(1);
      expect(unrelatedDetached.envelope.signatures[0]?.signerId).toBe(
        keyB.fingerprint,
      );

      const result = await client.muid.verifyFileDetached(
        unrelatedDetached.envelope,
        {
          muid: me.id,
        },
      );

      expect(result).toBeDefined();
      expect(result.signerId).toBe(keyB.fingerprint);
      expect(result.valid).toBe(false);
    });

    it("verifyFileDetached() selects the authenticated signer in a multisignature envelope", async () => {
      const me = await client.muid.me();

      expect(detachedEnvelopeMulti.signatures).toHaveLength(2);

      const signerIds = detachedEnvelopeMulti.signatures.map(
        (signature) => signature.signerId,
      );

      expect(new Set(signerIds).size).toBe(2);
      expect(signerIds).toContain(keyA.fingerprint);
      expect(signerIds).toContain(keyB.fingerprint);

      const result = await client.muid.verifyFileDetached(
        detachedEnvelopeMulti,
        {
          muid: me.id,
          expectedSignerId: keyA.fingerprint,
        },
      );

      expect(result).toBeDefined();
      expect(result.signerId).toBe(keyA.fingerprint);
      expect(result.valid).toBe(true);
    });

    it("verifyFileDetached() selects the unrelated signer in a multisignature envelope and returns false", async () => {
      const me = await client.muid.me();

      const result = await client.muid.verifyFileDetached(
        detachedEnvelopeMulti,
        {
          muid: me.id,
          expectedSignerId: keyB.fingerprint,
        },
      );

      expect(result).toBeDefined();
      expect(result.signerId).toBe(keyB.fingerprint);
      expect(result.valid).toBe(false);
    });

    // --------------------------------------------------------------------------
    // Ambiguity must still fail locally.
    // --------------------------------------------------------------------------

    it("verifyFileDetached() rejects ambiguous multisignature envelopes locally", async () => {
      expect(detachedEnvelopeMulti.signatures).toHaveLength(2);

      await expect(
        client.muid.verifyFileDetached(detachedEnvelopeMulti, {
          muid: "unused-because-validation-must-fail-first",
        }),
      ).rejects.toThrow(/expectedSignerId/i);
    });
  });
});
