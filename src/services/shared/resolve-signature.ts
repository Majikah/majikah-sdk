import type { MajikSignature } from "@majikah/majik-signature";
import { ValidationError } from "../../errors/ValidationError";

export interface ResolveSignatureOptions {
  /**
   * Appended to the "no signatures found" error — lets each caller point
   * to its own "sign it first" guidance (TSA vs MUID have different next
   * steps) without this shared helper needing to know about either.
   */
  noSignatureHint?: string;
}

/**
 * Resolves a single target signature out of a file/envelope's signature
 * list — the shared "which signer did you mean" logic used anywhere an
 * SDK method needs to act on exactly one existing signature rather than
 * create a new one (TSA timestamping an existing file, MUID verifying an
 * existing file).
 *
 * - No signatures at all → throws with an actionable hint.
 * - expectedSignerId provided → must match exactly, or throws.
 * - No expectedSignerId, exactly one signer → returns it.
 * - No expectedSignerId, multiple signers → throws asking for disambiguation,
 *   rather than silently guessing "the first" or "the last" one.
 */
export function resolveTargetSignature(
  signatures: MajikSignature[],
  expectedSignerId?: string,
  options?: ResolveSignatureOptions,
): MajikSignature {
  if (signatures.length === 0) {
    const hint = options?.noSignatureHint ? ` ${options.noSignatureHint}` : "";
    throw new ValidationError(`No signatures found.${hint}`, signatures);
  }

  if (expectedSignerId) {
    const match = signatures.find((s) => s.signerId === expectedSignerId);
    if (!match) {
      throw new ValidationError(
        `No signature found for signerId "${expectedSignerId}".`,
        expectedSignerId,
      );
    }
    return match;
  }

  if (signatures.length > 1) {
    throw new ValidationError(
      `This file/envelope has ${signatures.length} signers — pass expectedSignerId to disambiguate which one to use.`,
      signatures.map((s) => s.signerId),
    );
  }

  return signatures[0];
}
