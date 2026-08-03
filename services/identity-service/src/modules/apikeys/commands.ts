import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import {
  generateSecret, assertValidScopes, assertScope, isUsable,
  DomainError, type ApiKeyStatus, sha256Hex,
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
  acceptedStatus: "accepted";
};

/** Issue: mint secret in-process, publish hash to queue, return 202 + plaintext once. */
export async function issueApiKey(ctx: RequestContext, body: IssueApiKeyBody): Promise<IssueResult> {
  try { assertValidScopes(body.scopes); } catch (err) { mapDomainError(err); }

  const id = randomUUID();
  const { keyPrefix, fullKey, secretHash } = generateSecret();
  const expiresAt = body.expiresAt ? new Date(body.expiresAt).toISOString() : null;

  await queue.publish(COMMANDS.apiKeyIssue, {
    messageId: id,
    type: COMMANDS.apiKeyIssue,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id, tenantId: ctx.tenantId, name: body.name, keyPrefix, secretHash,
      scopes: body.scopes, expiresAt,
    },
  });

  return {
    id, keyPrefix, key: fullKey, scopes: body.scopes, status: "active",
    keyVersion: 1, correlationId: ctx.correlationId, acceptedStatus: "accepted",
  };
}

export async function rotateApiKey(ctx: RequestContext, id: string, reason?: string): Promise<IssueResult> {
  const { keyPrefix, fullKey, secretHash } = generateSecret();
  const messageId = randomUUID();
  await queue.publish(COMMANDS.apiKeyRotate, {
    messageId,
    type: COMMANDS.apiKeyRotate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, keyPrefix, secretHash, reason: reason ?? null },
  });
  return {
    id, keyPrefix, key: fullKey, scopes: [], status: "active",
    keyVersion: 0, correlationId: ctx.correlationId, acceptedStatus: "accepted",
  };
}

export async function revokeApiKey(
  ctx: RequestContext, id: string, reason?: string,
): Promise<{ id: string; status: "accepted"; correlationId: string }> {
  await queue.publish(COMMANDS.apiKeyRevoke, {
    messageId: randomUUID(),
    type: COMMANDS.apiKeyRevoke,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, reason: reason ?? null },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export type VerifyResult = {
  valid: boolean;
  apiKeyId?: string;
  tenantId?: string;
  scopes?: string[];
  reason?: string;
};

/** Verify remains synchronous (introspection). lastUsed touch is best-effort. */
export async function verifyApiKey(presented: string, requiredScope?: string): Promise<VerifyResult> {
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
