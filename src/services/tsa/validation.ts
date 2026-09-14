// services/tsa/validation.ts
import { ValidationError } from "../../errors/ValidationError";
import type { MajikTSARequest } from "../../types/tsa";
import { CONTENT_HASH_B64_LEN } from "@majikah/majik-signature";

export function validateTSARequest(req: MajikTSARequest): void {
  if (req?.digest?.algorithm !== "SHA-256") {
    throw new ValidationError('digest.algorithm must be "SHA-256"', req);
  }
  if (
    typeof req.digest.value !== "string" ||
    req.digest.value.length !== CONTENT_HASH_B64_LEN
  ) {
    throw new ValidationError(
      "digest.value must be a valid SHA-256 hex digest",
      req,
    );
  }
}
