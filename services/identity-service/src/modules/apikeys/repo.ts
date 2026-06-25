import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { apiKeys, apiKeyAudit, type ApiKeyRow, type ApiKeyInsert } from "./schema.js";
import type { ApiKeyView, ApiKeyStatus } from "./domain.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export function toView(r: ApiKeyRow): ApiKeyView {
  return {
    id: r.id, tenantId: r.tenantId, name: r.name, keyPrefix: r.keyPrefix,
    scopes: r.scopes ?? [], status: r.status as ApiKeyStatus, keyVersion: r.keyVersion,
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
    version: r.version,
  };
}

export async function findById(tx: Writer, tenantId: string, id: string): Promise<ApiKeyRow | null> {
  const rows = await tx.select().from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

/** Row-locked fetch for serialized lifecycle transitions. */
export async function findByIdForUpdate(tx: Writer, tenantId: string, id: string): Promise<ApiKeyRow | null> {
  const rows = await tx.select().from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.tenantId, tenantId)))
    .limit(1).for("update");
  return rows[0] ?? null;
}

/** Lookup by secret hash — NOT tenant-scoped because the key carries identity. */
export async function findBySecretHash(tx: Writer, secretHash: string): Promise<ApiKeyRow | null> {
  const rows = await tx.select().from(apiKeys)
    .where(eq(apiKeys.secretHash, secretHash)).limit(1);
  return rows[0] ?? null;
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<ApiKeyView[]> {
  const rows = await db.select().from(apiKeys)
    .where(eq(apiKeys.tenantId, tenantId))
    .orderBy(desc(apiKeys.createdAt)).limit(limit).offset(offset);
  return rows.map(toView);
}

export async function insert(tx: Writer, row: ApiKeyInsert): Promise<void> {
  await tx.insert(apiKeys).values(row);
}

/** Optimistic-locked update of mutable fields. Returns rows affected. */
export async function updateLifecycle(
  tx: Writer, tenantId: string, id: string, expectedVersion: number,
  patch: Partial<ApiKeyInsert>,
): Promise<number> {
  const res = await tx.update(apiKeys)
    .set({ ...patch, updatedAt: new Date(), version: expectedVersion + 1 })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.tenantId, tenantId), eq(apiKeys.version, expectedVersion)))
    .returning({ id: apiKeys.id });
  return res.length;
}

export async function touchLastUsed(tx: Writer, id: string, when: Date): Promise<void> {
  await tx.update(apiKeys).set({ lastUsedAt: when }).where(eq(apiKeys.id, id));
}

export async function audit(
  tx: Writer, tenantId: string, apiKeyId: string, action: string, actorId: string, detail: string | null,
): Promise<void> {
  await tx.insert(apiKeyAudit).values({ tenantId, apiKeyId, action, actorId, detail });
}

/** Emit a domain event + canonical audit row into the outbox (same tx). */
export async function emitAudit(
  tx: unknown, e: { eventType: string; tenantId: string; actorId: string; correlationId: string; payload: Record<string, unknown>; action: string; resourceId: string; outcome?: string; severity?: string; reason?: string },
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: e.eventType, eventType: e.eventType, tenantId: e.tenantId, actorId: e.actorId, correlationId: e.correlationId, payload: e.payload });
  await enqueue(t, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: e.tenantId, actorId: e.actorId, correlationId: e.correlationId,
    payload: {
      service: "identity", action: e.action, resourceType: "api_key", resourceId: e.resourceId,
      outcome: e.outcome ?? "success",
      ...(e.severity ? { severity: e.severity } : {}),
      ...(e.reason ? { reason: e.reason } : {}),
    },
  });
}
