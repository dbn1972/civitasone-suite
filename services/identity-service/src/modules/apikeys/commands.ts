import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import {
  generateSecret, assertValidScopes, assertScope, assertTransition, isUsable,
  DomainError, type ApiKeyStatus,
} from "./domain.js";
import type { IssueApiKeyBody } from "./validators.js";

function mapDomainError(err: unknown): never {
  if (err instanceof DomainError) {
    if (err.code === "OUT_OF_SCOPE") throw new HttpError(403, "FORBIDDEN", err.message);
    if (err.code === "INVALID_SCOPE") throw new HttpError(400, "VALIDATION_FAILED", err.message);
    if (err.code === "INVALID_TRANSITION") throw new HttpError(409, "CONFLICT", err.message);
    throw new HttpError(409, err.code, err.message);
  }
  throw err;
}

export type IssueResult = {
  id: string;
  keyPrefix: string;
  /** Full plaintext key — returned exactly once; never persisted or logged. */
  key: string;
  scopes: string[];
  status: ApiKeyStatus;
  keyVersion: number;
  correlationId: string;
};

/** Issue a brand-new API key. Synchronous: the secret is usable immediately. */
export async function issueApiKey(ctx: RequestContext, body: IssueApiKeyBody): Promise<IssueResult> {
  try { assertValidScopes(body.scopes); } catch (err) { mapDomainError(err); }

  const id = randomUUID();
  const { keyPrefix, fullKey, secretHash } = generateSecret();
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

  await db.transaction(async (tx) => {
    await repo.insert(tx, {
      id, tenantId: ctx.tenantId, name: body.name, keyPrefix, secretHash,
      scopes: body.scopes, status: "active", keyVersion: 1,
      expiresAt, createdBy: ctx.actorId, updatedBy: ctx.actorId, version: 1,
    });
    await repo.audit(tx, ctx.tenantId, id, "issue", ctx.actorId, `scopes=${body.scopes.join(",")}`);
    await repo.emitAudit(tx, {
      eventType: "identity.apikey.issued", tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, action: "issue", resourceId: id, severity: "high",
      payload: { apiKeyId: id, keyPrefix, scopes: body.scopes },
    });
  });

  return { id, keyPrefix, key: fullKey, scopes: body.scopes, status: "active", keyVersion: 1, correlationId: ctx.correlationId };
}

/**
 * Rotate: issue a NEW secret for the SAME key id, bump key_version, and
 * invalidate the previous secret immediately (the old hash is overwritten).
 * Serialized via row lock + optimistic version so two concurrent rotations
 * cannot both win.
 */
export async function rotateApiKey(ctx: RequestContext, id: string, reason?: string): Promise<IssueResult> {
  const { keyPrefix, fullKey, secretHash } = generateSecret();

  const out = await db.transaction(async (tx) => {
    const row = await repo.findByIdForUpdate(tx, ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "api key not found");
    try { assertTransition(row.status as ApiKeyStatus, "rotated"); } catch (err) { mapDomainError(err); }

    const newVersion = row.keyVersion + 1;
    const n = await repo.updateLifecycle(tx, ctx.tenantId, id, row.version, {
      keyPrefix, secretHash, keyVersion: newVersion, status: "active", updatedBy: ctx.actorId,
    });
    if (n === 0) throw new HttpError(409, "CONFLICT", "concurrent modification; retry");

    await repo.audit(tx, ctx.tenantId, id, "rotate", ctx.actorId, reason ?? null);
    await repo.emitAudit(tx, {
      eventType: "identity.apikey.rotated", tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, action: "rotate", resourceId: id, severity: "high",
      payload: { apiKeyId: id, keyPrefix, keyVersion: newVersion, ...(reason ? { reason } : {}) },
    });
    return { keyPrefix, keyVersion: newVersion, scopes: row.scopes ?? [] };
  });

  return { id, keyPrefix: out.keyPrefix, key: fullKey, scopes: out.scopes, status: "active", keyVersion: out.keyVersion, correlationId: ctx.correlationId };
}

/** Revoke: terminal. Idempotent — revoking an already-revoked key is a no-op success. */
export async function revokeApiKey(ctx: RequestContext, id: string, reason?: string): Promise<{ id: string; status: ApiKeyStatus; correlationId: string }> {
  const status = await db.transaction(async (tx) => {
    const row = await repo.findByIdForUpdate(tx, ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "api key not found");
    if (row.status === "revoked") return "revoked" as ApiKeyStatus; // idempotent

    const n = await repo.updateLifecycle(tx, ctx.tenantId, id, row.version, {
      status: "revoked", revokedAt: new Date(), updatedBy: ctx.actorId,
    });
    if (n === 0) throw new HttpError(409, "CONFLICT", "concurrent modification; retry");

    await repo.audit(tx, ctx.tenantId, id, "revoke", ctx.actorId, reason ?? null);
    await repo.emitAudit(tx, {
      eventType: "identity.apikey.revoked", tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, action: "revoke", resourceId: id, severity: "high",
      payload: { apiKeyId: id, ...(reason ? { reason } : {}) },
    });
    return "revoked" as ApiKeyStatus;
  });
  return { id, status, correlationId: ctx.correlationId };
}

export type VerifyResult = {
  valid: boolean;
  apiKeyId?: string;
  tenantId?: string;
  scopes?: string[];
  reason?: string;
};

/**
 * Verify a presented key, optionally enforcing a required scope. Constant-ish:
 * we hash the presented value and look it up. A miss / unusable key / out-of-scope
 * all return valid:false with a reason (and audit the denial) rather than leaking
 * which condition failed via differing status semantics at the boundary.
 */
export async function verifyApiKey(presented: string, requiredScope?: string): Promise<VerifyResult> {
  const { sha256Hex } = await import("./domain.js");
  const hash = sha256Hex(presented);

  return db.transaction(async (tx) => {
    const row = await repo.findBySecretHash(tx, hash);
    if (!row) return { valid: false, reason: "unknown key" };

    if (!isUsable(row.status as ApiKeyStatus, row.expiresAt ?? null)) {
      await repo.audit(tx, row.tenantId, row.id, "denied", row.id, `status=${row.status} unusable`);
      return { valid: false, apiKeyId: row.id, tenantId: row.tenantId, reason: "key not usable" };
    }
    if (requiredScope) {
      try {
        assertScope(row.scopes ?? [], requiredScope);
      } catch (err) {
        if (err instanceof DomainError && err.code === "OUT_OF_SCOPE") {
          await repo.audit(tx, row.tenantId, row.id, "denied", row.id, `out-of-scope ${requiredScope}`);
          return { valid: false, apiKeyId: row.id, tenantId: row.tenantId, scopes: row.scopes ?? [], reason: err.message };
        }
        throw err;
      }
    }
    await repo.touchLastUsed(tx, row.id, new Date());
    return { valid: true, apiKeyId: row.id, tenantId: row.tenantId, scopes: row.scopes ?? [] };
  });
}
