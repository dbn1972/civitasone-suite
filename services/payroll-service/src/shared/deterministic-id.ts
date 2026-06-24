import { createHash } from "node:crypto";

// Fixed namespace UUID for CivitasOne deterministic command ids. Stable forever:
// changing it would change every derived messageId and break idempotency dedup.
const NAMESPACE_HEX = "6f9619ff8b86d011b42d00cf4fc964ff";

/**
 * Deterministic RFC-4122 v5 UUID derived from `name` (SHA-1 of namespace||name).
 * Same input always yields the same UUID, so it is safe as an idempotency
 * messageId while satisfying the envelope's `z.string().uuid()` contract.
 */
export function deterministicUuid(name: string): string {
  const ns = Buffer.from(NAMESPACE_HEX, "hex");
  const hash = createHash("sha1").update(ns).update(name, "utf8").digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x50; // version 5
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC-4122 variant
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
