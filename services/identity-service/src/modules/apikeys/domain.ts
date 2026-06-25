import { createHash, randomBytes } from "node:crypto";

export type ApiKeyStatus = "active" | "rotated" | "revoked";

export type ApiKeyView = {
  id: string;
  tenantId: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  status: ApiKeyStatus;
  keyVersion: number;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  version: number;
};

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DomainError";
  }
}

// ── secret generation / hashing ─────────────────────────────────────────────
// A full key looks like `<prefix>.<secret>`. Only the SHA-256 hash of the full
// presented value is stored; the plaintext is returned to the caller exactly
// once at issue/rotate time and never again.

const PREFIX_NAMESPACE = "ak_live";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Generate a fresh (prefix, secret, fullKey, hash). */
export function generateSecret(): { keyPrefix: string; secret: string; fullKey: string; secretHash: string } {
  // 6 url-safe-ish hex chars of public prefix id, 32 bytes of secret entropy.
  const prefixId = randomBytes(3).toString("hex");
  const keyPrefix = `${PREFIX_NAMESPACE}_${prefixId}`;
  const secret = randomBytes(32).toString("base64url");
  const fullKey = `${keyPrefix}.${secret}`;
  return { keyPrefix, secret, fullKey, secretHash: sha256Hex(fullKey) };
}

// ── scope model ─────────────────────────────────────────────────────────────
// Scopes are `resource:action` tokens. A `*` wildcard in either segment matches
// anything in that segment (e.g. `users:*` covers `users:read`/`users:write`,
// `*:read` covers read on every resource, `*:*` is full access).

const SCOPE_FORMAT = /^(\*|[a-z][a-z0-9_]*)(:(\*|[a-z][a-z0-9_]*))$/;

export function isValidScope(scope: string): boolean {
  return SCOPE_FORMAT.test(scope);
}

export function assertValidScopes(scopes: string[]): void {
  for (const s of scopes) {
    if (!isValidScope(s)) {
      throw new DomainError("INVALID_SCOPE", `scope '${s}' is not a valid 'resource:action' token`);
    }
  }
}

function scopeMatches(granted: string, required: string): boolean {
  const [gRes, gAct] = granted.split(":");
  const [rRes, rAct] = required.split(":");
  const resOk = gRes === "*" || gRes === rRes;
  const actOk = gAct === "*" || gAct === rAct;
  return resOk && actOk;
}

/** Does this set of granted scopes satisfy the single required scope? */
export function scopesSatisfy(granted: string[], required: string): boolean {
  return granted.some((g) => scopeMatches(g, required));
}

/** Throws DomainError("OUT_OF_SCOPE") if the key lacks the required scope. */
export function assertScope(granted: string[], required: string): void {
  if (!scopesSatisfy(granted, required)) {
    throw new DomainError("OUT_OF_SCOPE", `api key lacks required scope '${required}'`);
  }
}

// ── lifecycle guards ────────────────────────────────────────────────────────
const ALLOWED: Record<ApiKeyStatus, ApiKeyStatus[]> = {
  active:  ["rotated", "revoked"],
  rotated: ["revoked"],   // a rotated key id is still revocable
  revoked: [],
};

export function canTransition(from: ApiKeyStatus, to: ApiKeyStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function assertTransition(from: ApiKeyStatus, to: ApiKeyStatus): void {
  if (from === to) return; // idempotent no-op handled by caller
  if (!canTransition(from, to)) {
    throw new DomainError("INVALID_TRANSITION", `cannot move api key from ${from} to ${to}`);
  }
}

/** A key is usable only while active and not past expiry. */
export function isUsable(status: ApiKeyStatus, expiresAt: Date | null, now = new Date()): boolean {
  if (status !== "active") return false;
  if (expiresAt && expiresAt.getTime() <= now.getTime()) return false;
  return true;
}
