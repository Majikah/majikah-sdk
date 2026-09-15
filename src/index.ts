export * from "./errors";
export * from "./types";
export * from "./services";
export { MajikahSDKClient } from "./client/MajikahSDKClient";

export { HttpClient, HttpRequestOptions } from "./transport/HttpClient";

export * from "@majikah/majik-notary";
export * from "@majikah/majik-key";
export * from "@majikah/majik-signature";
export {
  MajikUniversalID,
  type MajikUniversalIDJSON,
  type MajikID,
  type PublicProfile,
  type MajikKeyPublicBundle,
  type MajikSignerPublicKeys,
  type ResolvedSignerPublicKeys,
  MajikIDPublicView,
  MajikUser,
} from "@majikah/majik-universal-id";

export { createMuidPublicKeyResolver } from "./services/muid/key-resolver";
export { base64ToBytes, bytesToBase64 } from "./services/shared/encoding";
