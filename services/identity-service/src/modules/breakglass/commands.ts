import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { assertTtl, expiryFromNow, DomainError, type GrantStatus } from "./domain.js";
import type { GrantBody } from "./validators.js";

function mapDomainError(err: unknown): never {
  if (err instanceof DomainError) {
    if (err.code === "INVALID_TTL") throw new HttpError(400, "VALIDATION_FAILED", err.message);
    throw new HttpError(409, err.code, err.message);
  }
  throw err;
}

export type GrantResult = { id: string; status: GrantStatus; expiresAt: string; correlationId: string };

/**
 * Open a break-glass grant. At most ONE active grant per (tenant,user): the
 * partial unique index `uq_breakglass_one_active` is the real guard; we also
 * pre-check under the same tx for a friendly 409. A unique-violation from a
 * concurrent open is mapped to the same 409.
 */
export async function grant(ctx: RequestContext, body: GrantBody): Promise<GrantResult> {
  try { assertTtl(body.ttlMinutes); } catch (err) { mapDomainError(err); }
  const id = randomUUID();
  const expiresAt = expiryFromNow(body.ttlMinutes);

  try {
    await db.transaction(async (tx) => {
      const existing = await repo.findActiveForUser(tx, ctx.tenantId, body.userId);
      if (existing) {
        throw new HttpError(409, "BREAK_GLASS_ALREADY_ACTIVE", `an active break-glass grant already exists for this user (${existing.id})`);
      }
      await repo.insert(tx, {
        id, tenantId: ctx.tenantId, userId: body.userId, reason: body.reason, scope: body.scope,
        status: "active", grantedBy: ctx.actorId, expiresAt, version: 1,
      });
      await repo.emitAudit(tx, {
        eventType: "identity.breakglass.granted", tenantId: ctx.tenantId, actorId: ctx.actorId,
        correlationId: ctx.correlationId, action: "break_glass_grant", resourceId: id, severity: "critical",
        payload: { grantId: id, userId: body.userId, scope: body.scope, reason: body.reason, expiresAt: expiresAt.toISOString() },
      });
    });
  } catch (err) {
    // Concurrent open racing the partial-unique index → DB 23505.
    if (err instanceof Error && /uq_breakglass_one_active|duplicate key/.test(err.message)) {
      throw new HttpError(409, "BREAK_GLASS_ALREADY_ACTIVE", "an active break-glass grant already exists for this user");
    }
    throw err;
  }

  return { id, status: "active", expiresAt: expiresAt.toISOString(), correlationId: ctx.correlationId };
}

/**
 * Close a grant. Idempotent: closing an already-closed/expired grant is a
 * success no-op (returns the current terminal status). Only an in-force active
 * grant is actually transitioned to "closed".
 */
export async function close(ctx: RequestContext, id: string, reason?: string): Promise<GrantResult> {
  const out = await db.transaction(async (tx) => {
    const row = await repo.findByIdForUpdate(tx, ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "break-glass grant not found");

    if (row.status !== "active") {
      // idempotent: already terminal (closed or expired)
      return { status: row.status as GrantStatus, expiresAt: row.expiresAt.toISOString() };
    }
    const n = await repo.setStatus(tx, ctx.tenantId, id, row.version, {
      status: "closed", closedBy: ctx.actorId, closeReason: reason ?? null, closedAt: new Date(),
    });
    if (n === 0) throw new HttpError(409, "CONFLICT", "concurrent modification; retry");

    await repo.emitAudit(tx, {
      eventType: "identity.breakglass.closed", tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, action: "break_glass_close", resourceId: id, severity: "critical",
      payload: { grantId: id, userId: row.userId, ...(reason ? { reason } : {}) },
    });
    return { status: "closed" as GrantStatus, expiresAt: row.expiresAt.toISOString() };
  });
  return { id, status: out.status, expiresAt: out.expiresAt, correlationId: ctx.correlationId };
}
