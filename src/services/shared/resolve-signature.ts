import type { MajikSignature } from "@majikah/majik-signature";
import { ValidationError } from "../../errors/ValidationError";

export interface ResolveSignatureOptions {
  /**
   * Appended to the "no signatures found" error.
   */
  noSignatureHint?: string;
}

/**
 * Resolve exactly one signature from a signature collection.
 *
 * Rules:
 * - No signatures -> ValidationError.
 * - expectedSignerId supplied -> exact signer match is required.
 * - One signature and no expectedSignerId -> return it.
 * - Multiple signatures and no expectedSignerId -> ValidationError.
 *
 * This helper deliberately never guesses which signer the caller intended.
 */
export function resolveTargetSignature(
  signatures: MajikSignature[],
  expectedSignerId?: string,
  options?: ResolveSignatureOptions,
): MajikSignature {
  if (!Array.isArray(signatures) || signatures.length === 0) {
    const hint = options?.noSignatureHint
      ? ` ${options.noSignatureHint}`
      : "";

    throw new ValidationError(
      `No signatures found.${hint}`,
      signatures,
    );
  }

  if (expectedSignerId !== undefined) {
    if (typeof expectedSignerId !== "string") {
      throw new ValidationError(
        "expectedSignerId must be a non-empty string when provided.",
        expectedSignerId,
      );
    }

    const normalizedExpectedSignerId = expectedSignerId.trim();

    if (!normalizedExpectedSignerId) {
      throw new ValidationError(
        "expectedSignerId must be a non-empty string when provided.",
        expectedSignerId,
      );
    }

    const match = signatures.find(
      (signature) => signature.signerId === normalizedExpectedSignerId,
    );

    if (!match) {
      throw new ValidationError(
        `No signature found for signerId "${normalizedExpectedSignerId}".`,
        normalizedExpectedSignerId,
      );
    }

    return match;
  }

  if (signatures.length > 1) {
    throw new ValidationError(
      `This file/envelope has ${signatures.length} signers — pass expectedSignerId to disambiguate which one to use.`,
      signatures.map((signature) => signature.signerId),
    );
  }

  return signatures[0];
}