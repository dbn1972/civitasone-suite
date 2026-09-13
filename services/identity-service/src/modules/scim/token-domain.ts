import { createHash, randomBytes } from "node:crypto";
import type { ScimTokenStatus } from "./schema.js";

// SEC-007 — secret generation / hashing for per-tenant SCIM bearer tokens.
// A full token looks like `<prefix>.<secret>`. Only the SHA-256 hash of the
// full presented value is ever stored; the plaintext is returned to the
// caller exactly once, at issue time, and never again. Mirrors
// ../apikeys/domain.ts's generateSecret()/sha256Hex() (kept as a separate,
// self-contained copy rather than a cross-module import, matching how each
// identity-service module already keeps its own domain.ts).

const PREFIX_NAMESPACE = "scim_live";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Generate a fresh (tokenPrefix, fullToken, secretHash). */
export function generateScimSecret(): { tokenPrefix: string; fullToken: string; secretHash: string } {
  const prefixId = randomBytes(3).toString("hex");
  const tokenPrefix = `${PREFIX_NAMESPACE}_${prefixId}`;
  const secret = randomBytes(32).toString("base64url");
  const fullToken = `${tokenPrefix}.${secret}`;
  return { tokenPrefix, fullToken, secretHash: sha256Hex(fullToken) };
}

/** A token is usable only while active and not past expiry. */
export function isUsable(
  row: { status: ScimTokenStatus | string; expiresAt: Date | null },
  now = new Date(),
): boolean {
  if (row.status !== "active") return false;
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}
