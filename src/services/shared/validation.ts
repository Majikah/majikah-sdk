import { ValidationError } from "../../errors";

export function isSHA256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

/**
 * Validates that a string contains a non-empty, non-whitespace value.
 *
 * @param value Value to validate.
 * @param field Field name used in the validation error message.
 * @throws ValidationError When the value is empty or not a string.
 */
export function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${field} must be a non-empty string`, value);
  }
}
