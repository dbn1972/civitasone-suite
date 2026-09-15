import { createHash } from "node:crypto";

// Fixed namespace for deterministic UUIDv5 derivation within hrms-service.
const HRMS_NS = "7c9e6f3a-b0d4-4f31-9c2b-6a1e5d8f2b4a";

/**
 * Deterministic UUIDv5 (SHA-1, namespaced) for a string name. Produces a STABLE,
 * RFC-4122-valid UUID, so derived identity/idempotency keys can be stored in uuid
 * columns and reused across redeliveries.
 *
 * Mirrors asset-service's `shared/ids.ts` (services/asset-service/src/shared/ids.ts),
 * the established pattern in this codebase for a PER-ITEM idempotency key inside a
 * bulk/multi-item consumer: `_inbox.processed.message_id` is a uuid column, so a
 * composite key like `${msg.messageId}:${itemId}` cannot be inserted as-is (it isn't
 * valid uuid syntax) and must be derived through a function like this one instead.
 */
export function uuidV5(name: string, namespace: string = HRMS_NS): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(nsBytes).update(Buffer.from(name, "utf8")).digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
