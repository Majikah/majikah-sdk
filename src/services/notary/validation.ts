import { SEAL_HASH_HEX_LEN } from "@majikah/majik-signature";
import { ValidationError } from "../../errors/ValidationError";

/**
 * Mirrors the gateway's own validateNotaryRequest() exactly — SHA3-512,
 * hex-encoded, SEAL_HASH_HEX_LEN (128) characters. Distinct from TSA's
 * content hash (base64/SHA-256) — different hash, different encoding,
 * different length; don't conflate the two.
 */
export function validateSealHash(sealHash: string): void {
  if (typeof sealHash !== "string") {
    throw new ValidationError("sealHash must be a string", sealHash);
  }
  if (sealHash.length !== SEAL_HASH_HEX_LEN) {
    throw new ValidationError(
      `sealHash must be exactly ${SEAL_HASH_HEX_LEN} hex characters (SHA3-512), got ${sealHash.length}`,
      sealHash,
    );
  }
  if (!/^[0-9a-f]+$/i.test(sealHash)) {
    throw new ValidationError("sealHash must be a hex string", sealHash);
  }
}
