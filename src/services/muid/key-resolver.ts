import type { MUIDClient } from "./MUIDClient";

import { base64ToBytes } from "../shared/encoding";
import { PublicKeyResolver } from "../../types/slink";

/**
 * Creates a public key resolver backed by MUID lookups.
 *
 * The resolver fetches the signer's MUID profile and converts its Base64-
 * encoded signing keys into the `Uint8Array` format required by
 * `PublicKeyResolver`.
 *
 * @param muidClient MUID client used to resolve public identity information.
 * @returns A public key resolver suitable for `verifyUrlWithProof()` or
 * `verifyMatches()`.
 *
 * @example
 * ```ts
 * const resolvePublicKeys = createMuidPublicKeyResolver(majikah.muid);
 *
 * const results = await majikah.slink.verifyUrlWithProof(
 *   "thezelijah.world",
 *   resolvePublicKeys,
 * );
 * ```
 */
export function createMuidPublicKeyResolver(
  muidClient: MUIDClient,
): PublicKeyResolver {
  return async (muid, signerId) => {
    const profile = await muidClient.lookup(muid);

    return {
      signerId,
      edPublicKey: base64ToBytes(profile.muid.signing_key.ed_public_key),
      mlDsaPublicKey: base64ToBytes(profile.muid.signing_key.ml_dsa_public_key),
    };
  };
}
