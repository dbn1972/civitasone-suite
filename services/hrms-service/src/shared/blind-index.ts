/**
 * Blind index for the UAN (and the pattern for any other encrypted identifier that must stay searchable).
 *
 * UAN is stored AES-GCM encrypted with a random IV (pii-crypto.ts), so `WHERE uan_number = $1` can never match.
 * The blind index is a keyed HMAC-SHA256 of the normalised value, stored in `uan_bidx` ("<keyid>.<hex>"):
 *   - exact match only (no prefix / LIKE), computable only with the key, so the column on its own reveals nothing
 *     but equality between two rows of the SAME tenant (the tenant id is part of the MAC input);
 *   - the key is HKDF-derived (domain separated) from the same keyring key that encrypts the row, so it uses the
 *     existing secret mechanism (PII_ENC_KEY / PII_ENC_KEYRING / PII_ENC_SALT): no new secret to provision;
 *   - the key id is stored with the value. A lookup computes one candidate per key still in the keyring, so rows
 *     written under a retired key keep matching after PII_ENC_KEY rotation, with no re-index required.
 * Values are never logged by this module.
 */
import { createHmac } from "node:crypto";
import { blindIndexKeys } from "./pii-crypto.js";

/** Trim and drop inner whitespace; null for empty. The format (12 digits) is validated by the API, not here. */
export function normaliseUan(v: string | null | undefined): string | null {
  const t = (v ?? "").replace(/\s+/g, "");
  return t.length > 0 ? t : null;
}

function mac(key: Buffer, tenantId: string, value: string): string {
  return createHmac("sha256", key).update(`hrms.uan.v1\u0000${tenantId}\u0000${value}`).digest("hex");
}

/** The value to STORE for a UAN (active key). null when there is nothing to index. */
export function uanBlindIndex(tenantId: string, uan: string | null | undefined): string | null {
  const n = normaliseUan(uan);
  if (!n) return null;
  const { activeKeyId, keys } = blindIndexKeys();
  const k = keys.get(activeKeyId);
  if (!k) throw new Error("active PII key missing from keyring");
  return `${activeKeyId}.${mac(k, tenantId, n)}`;
}

/** Every value a stored index for this UAN could hold (one per keyring key), for lookups. */
export function uanBlindIndexCandidates(tenantId: string, uan: string | null | undefined): string[] {
  const n = normaliseUan(uan);
  if (!n) return [];
  const { keys } = blindIndexKeys();
  return [...keys].map(([kid, k]) => `${kid}.${mac(k, tenantId, n)}`);
}

/** Key id of a stored index value (the part before the first dot), or null if malformed. */
export function blindIndexKeyId(stored: string | null | undefined): string | null {
  const i = (stored ?? "").indexOf(".");
  return i > 0 ? stored!.slice(0, i) : null;
}

/** The key id new writes use. */
export function activeBlindIndexKeyId(): string {
  return blindIndexKeys().activeKeyId;
}
