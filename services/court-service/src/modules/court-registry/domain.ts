import { createHash } from "node:crypto";

/**
 * court-registry pure domain helpers — no I/O.
 *
 * The court/authority hierarchy (§6) and court types (§5.1) are NOT hardcoded
 * here: they are tenant configuration validated by the config/metadata engine
 * (§47). This module owns only structural rules — id derivation for idempotency
 * and normalization of the establishment code.
 */

/** RFC 4122 §4.3 UUIDv5 over a fixed namespace + name → stable, collision-free id. */
export function deterministicId(namespace: string, name: string): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const nameBytes = Buffer.from(name, "utf8");
  const hash = createHash("sha1").update(nsBytes).update(nameBytes).digest();
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50; // version 5
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** court-registry UUIDv5 namespace (distinct from case-registry's). */
export const COURT_NAMESPACE = "b2e7a4d1-9c33-4f0a-8e21-5d6c7b8a9f01";

export function normalizeEstablishmentCode(code: string): string {
  return code.replace(/\s+/g, "").toUpperCase();
}

/**
 * A court id is deterministic on (tenantId + establishmentCode) when a code is
 * supplied — so re-submitting the same establishment is idempotent end-to-end —
 * else it falls back to `fallback` (a random UUID minted by the caller).
 */
export function deriveCourtId(tenantId: string, establishmentCode: string | undefined, fallback: string): string {
  if (!establishmentCode) return fallback;
  return deterministicId(COURT_NAMESPACE, `${tenantId}:court:${normalizeEstablishmentCode(establishmentCode)}`);
}

/** A bench id is deterministic on (tenantId + courtId + bench name). */
export function deriveBenchId(tenantId: string, courtId: string, name: string): string {
  return deterministicId(COURT_NAMESPACE, `${tenantId}:bench:${courtId}:${name.trim().toLowerCase()}`);
}
