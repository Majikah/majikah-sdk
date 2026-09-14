import {
  FileLike,
} from "@majikah/majik-signature";

/**
 * Converts a Base64-encoded string into raw bytes.
 *
 * Uses the runtime's `atob()` implementation and returns the decoded
 * content as a `Uint8Array`.
 *
 * @param b64 Base64-encoded string.
 * @returns Decoded bytes.
 * @throws DOMException When the input is not valid Base64.
 */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

/**
 * Converts raw bytes into a Base64-encoded string.
 *
 * @param bytes Bytes to encode.
 * @returns Base64 representation of the provided bytes.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

export function bytesToBlob(bytes: Uint8Array, mimeType: string): Blob {
  return new Blob([bytes as BlobPart], { type: mimeType });
}

export function normalizeToBlob(
  input: FileLike,
  mimeType: string = "application/octet-stream",
): Blob {
  if (input instanceof Blob) return input;
  if (input instanceof Uint8Array) return bytesToBlob(input, mimeType);
  if (input instanceof ArrayBuffer)
    return bytesToBlob(new Uint8Array(input), mimeType);
  throw new Error(
    "Unsupported file input — expected Blob, File, Uint8Array, or ArrayBuffer.",
  );
}
