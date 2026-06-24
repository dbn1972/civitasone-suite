import { createHash } from "node:crypto";

// Fixed namespace for deterministic UUIDv5 derivation within asset-service.
const ASSET_NS = "6f9619ff-8b86-d011-b42d-00c04fc964ff";

/**
 * Deterministic UUIDv5 (SHA-1, namespaced) for a string name. Produces a STABLE,
 * RFC-4122-valid UUID, so derived identity/idempotency keys can be stored in uuid
 * columns and reused across redeliveries.
 */
export function uuidV5(name: string, namespace: string = ASSET_NS): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(nsBytes).update(Buffer.from(name, "utf8")).digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
