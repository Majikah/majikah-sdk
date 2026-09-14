/**
 * sdk-slink.test.ts
 *
 * Integration tests for SLinkClient — no mocks. Live tests hit the real
 * gateway configured via MAJIKAH_API_BASE_URL (or production if unset)
 * using MAJIKAH_API_KEY from .env.
 *
 * Coverage:
 *   Client-side validation:
 *     - URL normalization
 *     - required argument validation
 *     - invalid/empty input rejection
 *
 *   Live lifecycle:
 *     - register
 *     - list/me
 *     - verify by hash
 *     - verify by URL
 *     - lookup
 *     - cryptographic proof verification
 *     - independent MajikSLink verification
 *     - delete
 *     - deleted-resource verification
 *
 *   Negative live cases:
 *     - nonexistent hash
 *     - nonexistent URL
 *     - nonexistent SLink id
 *     - repeated delete
 *     - invalid API key
 *     - proof verification with no matches
 *
 *   Existing SLink:
 *     - bare-domain normalization
 *     - explicit HTTPS equivalence
 *     - cryptographic proof execution
 */

import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MajikKey } from "@majikah/majik-key";
import { MajikSLink } from "@majikah/majik-slink";

import { MajikahSDKClient } from "../src/client/MajikahSDKClient";
import { createMuidPublicKeyResolver } from "../src/services/muid/key-resolver";
import { normalizeUrl } from "../src/services/slink/validation";
import { ValidationError } from "../src/errors/ValidationError";
import { APIError } from "../src/errors/APIError";
import { AuthenticationError } from "../src/errors/AuthenticationError";

import { getTestKey } from "./helpers/crypto";

const API_KEY = process.env.MAJIKAH_API_KEY;
const BASE_URL = process.env.MAJIKAH_API_BASE_URL;

const hasApiKey = Boolean(API_KEY);

if (!hasApiKey) {
  console.warn(
    "[sdk-slink.test] MAJIKAH_API_KEY not set — skipping live gateway tests. " +
      "Client-side validation tests still run.",
  );
}

const TEST_URL = "https://www.linkedin.com/in/jedlsf/";
const EXISTING_URL = "thezelijah.world";

const NONEXISTENT_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";

const NONEXISTENT_ID = "definitely-not-a-real-id-00000";

const NONEXISTENT_URL =
  "https://this-domain-should-not-exist-for-majikah-slink-tests.invalid/";

describe("SLinkClient", () => {
  let keyA: MajikKey;
  let client: MajikahSDKClient;

  beforeAll(async () => {
    keyA = await getTestKey();

    client = new MajikahSDKClient({
      apiKey: API_KEY ?? "unused-placeholder-when-no-key-configured",
      ...(BASE_URL ? { baseUrl: BASE_URL } : {}),
    });
  }, 60_000);

  // ---------------------------------------------------------------------------
  // CLIENT-SIDE VALIDATION
  // ---------------------------------------------------------------------------

  describe("Client-side validation (no network)", () => {
    describe("normalizeUrl()", () => {
      it("adds https:// to a bare domain", () => {
        expect(normalizeUrl("thezelijah.world")).toBe(
          "https://thezelijah.world",
        );
      });

      it("adds https:// to a bare domain with a path", () => {
        expect(normalizeUrl("thezelijah.world/about")).toBe(
          "https://thezelijah.world/about",
        );
      });

      it("preserves an explicit https:// URL", () => {
        expect(normalizeUrl("https://thezelijah.world")).toBe(
          "https://thezelijah.world",
        );
      });

      it("preserves an explicit https:// URL with a path and query", () => {
        const url = "https://thezelijah.world/profile?source=slink";

        expect(normalizeUrl(url)).toBe(url);
      });

      it("preserves an explicit http:// URL", () => {
        expect(normalizeUrl("http://thezelijah.world")).toBe(
          "http://thezelijah.world",
        );
      });

      it("detects schemes case-insensitively", () => {
        expect(normalizeUrl("HTTPS://thezelijah.world")).toBe(
          "HTTPS://thezelijah.world",
        );

        expect(normalizeUrl("HTTP://thezelijah.world")).toBe(
          "HTTP://thezelijah.world",
        );
      });

      it("rejects an empty string", () => {
        expect(() => normalizeUrl("")).toThrow(ValidationError);
      });

      it("rejects whitespace-only input", () => {
        expect(() => normalizeUrl("   ")).toThrow(ValidationError);
      });
    });

    describe("create()", () => {
      it("rejects undefined slink input", async () => {
        await expect(
          client.slink.create(undefined as any),
        ).rejects.toBeInstanceOf(ValidationError);
      });

      it("rejects an empty slink input", async () => {
        await expect(client.slink.create("" as any)).rejects.toBeInstanceOf(
          ValidationError,
        );
      });
    });

    describe("verifyByHash()", () => {
      it("rejects an empty hash", async () => {
        await expect(client.slink.verifyByHash("")).rejects.toBeInstanceOf(
          ValidationError,
        );
      });

      it("rejects whitespace-only hashes", async () => {
        await expect(client.slink.verifyByHash("   ")).rejects.toBeInstanceOf(
          ValidationError,
        );
      });
    });

    describe("verifyUrl()", () => {
      it("rejects an empty URL", async () => {
        await expect(client.slink.verifyUrl("")).rejects.toBeInstanceOf(
          ValidationError,
        );
      });

      it("rejects whitespace-only URLs", async () => {
        await expect(client.slink.verifyUrl("   ")).rejects.toBeInstanceOf(
          ValidationError,
        );
      });
    });

    describe("verifyUrlWithProof()", () => {
      it("rejects an empty URL", async () => {
        await expect(
          client.slink.verifyUrlWithProof(
            "",
            createMuidPublicKeyResolver(client.muid),
          ),
        ).rejects.toBeInstanceOf(ValidationError);
      });
    });

    describe("lookup()", () => {
      it("rejects an empty id", async () => {
        await expect(client.slink.lookup("")).rejects.toBeInstanceOf(
          ValidationError,
        );
      });

      it("rejects whitespace-only ids", async () => {
        await expect(client.slink.lookup("   ")).rejects.toBeInstanceOf(
          ValidationError,
        );
      });
    });

    describe("delete()", () => {
      it("rejects an empty id", async () => {
        await expect(client.slink.delete("")).rejects.toBeInstanceOf(
          ValidationError,
        );
      });

      it("rejects whitespace-only ids", async () => {
        await expect(client.slink.delete("   ")).rejects.toBeInstanceOf(
          ValidationError,
        );
      });
    });
  });

  // ---------------------------------------------------------------------------
  // LIVE GATEWAY — FULL LIFECYCLE
  // ---------------------------------------------------------------------------

  describe.skipIf(!hasApiKey)(
    "Live gateway integration — full lifecycle",
    () => {
      let userId: string;
      let muid: string;

      let createdId: string | undefined;
      let createdHash: string | undefined;

      beforeAll(async () => {
        const profile = await client.muid.me();

        userId = profile.user_id;
        muid = profile.id;

        expect(userId).toBeTruthy();
        expect(muid).toBeTruthy();
      }, 30_000);

      afterAll(async () => {
        /**
         * Safety net:
         *
         * If a test fails after registerUrl() succeeds but before delete()
         * runs, do not leave a test SLink behind.
         */
        if (!createdId) {
          return;
        }

        try {
          await client.slink.delete(createdId);
        } catch {
          // Resource may already have been deleted by the lifecycle test.
        }
      }, 30_000);

      it("registerUrl() creates a new SLink", async () => {
        const stored = await client.slink.registerUrl(
          TEST_URL,
          keyA,
          userId,
          muid,
          {
            claimType: "reference",
          },
        );

        expect(stored).toBeDefined();
        expect(stored.id).toBeTruthy();
        expect(stored.hash).toBeTruthy();

        expect(stored.user_id).toBe(userId);
        expect(stored.muid).toBe(muid);

        expect(stored.domain).toBe("linkedin.com");
        expect(stored.claim_type).toBe("reference");
        expect(stored.verification_method).toBeNull();

        expect(stored.signature).toBeDefined();
        expect(stored.signature.signerId).toBe(keyA.fingerprint);

        createdId = stored.id;
        createdHash = stored.hash;
      }, 30_000);

      it("me() returns a valid page and contains the newly created SLink", async () => {
        expect(createdId).toBeTruthy();

        const page = await client.slink.me({ limit: 50 });

        expect(page).toBeDefined();
        expect(Array.isArray(page.items)).toBe(true);
        expect(typeof page.has_more).toBe("boolean");

        expect(page.items.some((s) => s.id === createdId)).toBe(true);
      }, 30_000);

      it("verifyByHash() finds the newly created SLink", async () => {
        expect(createdHash).toBeTruthy();
        expect(createdId).toBeTruthy();

        const result = await client.slink.verifyByHash(createdHash!);

        expect(result).toBeDefined();
        expect(result.hash).toBe(createdHash);
        expect(result.count).toBeGreaterThan(0);
        expect(Array.isArray(result.matches)).toBe(true);

        const match = result.matches.find((m) => m.slink.id === createdId);

        expect(match).toBeDefined();
        expect(match!.slink.hash).toBe(createdHash);
      }, 30_000);

      it("verifyByHash() returns no matches for an unknown hash", async () => {
        const result = await client.slink.verifyByHash(NONEXISTENT_HASH);

        expect(result).toBeDefined();
        expect(result.hash).toBe(NONEXISTENT_HASH);
        expect(result.count).toBe(0);
        expect(result.matches).toEqual([]);
      }, 30_000);

      it("verifyUrl() finds the newly created SLink", async () => {
        expect(createdId).toBeTruthy();

        const result = await client.slink.verifyUrl(TEST_URL);

        expect(result).toBeDefined();
        expect(result.count).toBeGreaterThan(0);
        expect(Array.isArray(result.matches)).toBe(true);

        expect(result.matches.some((m) => m.slink.id === createdId)).toBe(true);
      }, 30_000);

      it("verifyUrl() returns no matches for an unknown URL", async () => {
        const result = await client.slink.verifyUrl(NONEXISTENT_URL);

        expect(result).toBeDefined();
        expect(result.count).toBe(0);
        expect(result.matches).toEqual([]);
      }, 30_000);

      it("lookup() returns the public SLink view paired with its MUID", async () => {
        expect(createdId).toBeTruthy();
        expect(createdHash).toBeTruthy();

        const view = await client.slink.lookup(createdId!);

        expect(view).toBeDefined();
        expect(view.slink).toBeDefined();
        expect(view.muid).toBeDefined();

        expect(view.slink.id).toBe(createdId);
        expect(view.slink.hash).toBe(createdHash);

        expect(view.muid.id).toBe(muid);
        expect(view.muid.user_id).toBe(userId);
      }, 30_000);

      it("lookup() returns 404 for a nonexistent SLink id", async () => {
        const err = await client.slink.lookup(NONEXISTENT_ID).catch((e) => e);

        expect(err).toBeInstanceOf(APIError);
        expect((err as APIError).status).toBe(404);
      }, 30_000);

      it("verifyUrlWithProof() cryptographically validates the created SLink", async () => {
        expect(createdId).toBeTruthy();

        const results = await client.slink.verifyUrlWithProof(
          TEST_URL,
          createMuidPublicKeyResolver(client.muid),
        );

        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);

        const ownMatch = results.find((r) => r.match.slink.id === createdId);

        expect(ownMatch).toBeDefined();

        expect(ownMatch!.result).toBeDefined();
        expect(ownMatch!.result.valid).toBe(true);
        expect(ownMatch!.result.signerId).toBe(keyA.fingerprint);
      }, 30_000);

      it("verifyUrlWithProof() returns no matches for an unknown URL", async () => {
        const results = await client.slink.verifyUrlWithProof(
          NONEXISTENT_URL,
          createMuidPublicKeyResolver(client.muid),
        );

        expect(results).toEqual([]);
      }, 30_000);

      it("resolveSignature()/verify() independently confirms the SDK proof result", async () => {
        expect(createdId).toBeTruthy();

        const view = await client.slink.lookup(createdId!);
        const slink = MajikSLink.fromJSON(view.slink);

        const publicKeys = await createMuidPublicKeyResolver(client.muid)(
          muid,
          keyA.fingerprint,
        );

        const result = slink.verify(publicKeys);

        expect(result).toBeDefined();
        expect(result.valid).toBe(true);
      }, 30_000);

      let deletedId: string | undefined;

      it("delete() removes the created SLink", async () => {
        expect(createdId).toBeTruthy();

        deletedId = createdId;

        const result = await client.slink.delete(createdId!);

        expect(result.id).toBe(deletedId);

        createdId = undefined;
      });

      it("lookup() returns 404 for the deleted SLink", async () => {
        expect(deletedId).toBeTruthy();

        const err = await client.slink.lookup(deletedId!).catch((e) => e);

        expect(err).toBeInstanceOf(APIError);
        expect((err as APIError).status).toBe(404);
      });
    },
  );

  // ---------------------------------------------------------------------------
  // EXISTING SLINK — READ ONLY
  // ---------------------------------------------------------------------------

  describe.skipIf(!hasApiKey)(
    "Existing SLink — read-only checks (thezelijah.world)",
    () => {
      it("verifyUrl() finds the existing SLink using a bare domain", async () => {
        const result = await client.slink.verifyUrl(EXISTING_URL);

        expect(result).toBeDefined();
        expect(result.count).toBeGreaterThan(0);
        expect(result.matches.length).toBeGreaterThan(0);

        for (const match of result.matches) {
          expect(match.slink.domain).toContain("thezelijah.world");
        }
      }, 30_000);

      it("verifyUrl() returns the same hash for bare and explicit HTTPS URLs", async () => {
        const bare = await client.slink.verifyUrl(EXISTING_URL);

        const explicit = await client.slink.verifyUrl(
          `https://${EXISTING_URL}`,
        );

        expect(explicit.hash).toBe(bare.hash);
      }, 30_000);

      it("verifyUrl() returns the same match count for bare and explicit HTTPS URLs", async () => {
        const bare = await client.slink.verifyUrl(EXISTING_URL);

        const explicit = await client.slink.verifyUrl(
          `https://${EXISTING_URL}`,
        );

        expect(explicit.count).toBe(bare.count);
      }, 30_000);

      it("verifyUrlWithProof() executes cryptographic verification for every match", async () => {
        const results = await client.slink.verifyUrlWithProof(
          EXISTING_URL,
          createMuidPublicKeyResolver(client.muid),
        );

        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);

        for (const { match, result } of results) {
          expect(match).toBeDefined();
          expect(match.slink).toBeDefined();
          expect(match.slink.hash).toBeTruthy();

          expect(result).toBeDefined();
          expect(typeof result.valid).toBe("boolean");
        }
      }, 30_000);
    },
  );

  // ---------------------------------------------------------------------------
  // AUTHENTICATION / ERROR MAPPING
  // ---------------------------------------------------------------------------

  describe.skipIf(!hasApiKey)("Error handling against the real gateway", () => {
    it("throws AuthenticationError for an invalid API key", async () => {
      const badClient = new MajikahSDKClient({
        apiKey: "obviously-invalid-key",
        ...(BASE_URL ? { baseUrl: BASE_URL } : {}),
      });

      await expect(badClient.slink.me()).rejects.toBeInstanceOf(
        AuthenticationError,
      );
    }, 15_000);

    it("maps a nonexistent lookup to APIError(404)", async () => {
      const err = await client.slink.lookup(NONEXISTENT_ID).catch((e) => e);

      expect(err).toBeInstanceOf(APIError);
      expect((err as APIError).status).toBe(404);
    }, 15_000);

    it("maps deletion of a nonexistent SLink to a not-found API error", async () => {
      const err = await client.slink.delete(NONEXISTENT_ID).catch((e) => e);

      expect(err).toBeInstanceOf(APIError);
      expect((err as APIError).status).toBe(404);
    }, 15_000);
  });
});
