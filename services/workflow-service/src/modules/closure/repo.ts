import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, scopedRead, type Db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { entityClosures, type ClosureRow } from "./schema.js";
import type { ClosureStatus } from "./domain.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function find(tenantId: string, entityType: string, entityId: string): Promise<ClosureRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(entityClosures)
    .where(and(eq(entityClosures.tenantId, tenantId), eq(entityClosures.entityType, entityType), eq(entityClosures.entityId, entityId))).limit(1));
  return rows[0];
}

/** Fetch the current status, defaulting to 'open' for a never-tracked entity. */
export async function currentStatus(tenantId: string, entityType: string, entityId: string): Promise<ClosureStatus> {
  const row = await find(tenantId, entityType, entityId);
  return (row?.status as ClosureStatus) ?? "open";
}

async function audit(tx: Tx, tenantId: string, actorId: string, correlationId: string, action: string, entityType: string, entityId: string, detail: Record<string, unknown>): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId, actorId, correlationId,
    payload: { service: "workflow", action, resourceType: entityType, resourceId: entityId, outcome: "success", detail },
  });
}

export interface CloseInput { tenantId: string; entityType: string; entityId: string; reason: string; actorId: string; correlationId: string; }

/** Close: upsert the row to status='closed' only from open/reopened. */
export async function close(input: CloseInput): Promise<ClosureRow | null> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const existing = (await tx.select().from(entityClosures)
      .where(and(eq(entityClosures.tenantId, input.tenantId), eq(entityClosures.entityType, input.entityType), eq(entityClosures.entityId, input.entityId))).limit(1))[0];
    if (!existing) {
      const insRows = await tx.insert(entityClosures).values({
        id: randomUUID(), tenantId: input.tenantId, entityType: input.entityType, entityId: input.entityId,
        status: "closed", closedBy: input.actorId, closedAt: now, closureReason: input.reason,
      }).returning();
      await audit(tx as Tx, input.tenantId, input.actorId, input.correlationId, "entity_closed", input.entityType, input.entityId, {});
      return insRows[0]!;
    }
    if (existing.status !== "open" && existing.status !== "reopened") return null;
    const res = await tx.update(entityClosures)
      .set({ status: "closed", closedBy: input.actorId, closedAt: now, closureReason: input.reason, updatedAt: now })
      .where(and(eq(entityClosures.id, existing.id), eq(entityClosures.status, existing.status)))
      .returning();
    if (res.length === 0) return null;
    await audit(tx as Tx, input.tenantId, input.actorId, input.correlationId, "entity_closed", input.entityType, input.entityId, {});
    return res[0]!;
  });
}

export type ReopenInput = CloseInput;

/** Reopen: only from closed; increments reopen_count. */
export async function reopen(input: ReopenInput): Promise<ClosureRow | null> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const res = await tx.update(entityClosures)
      .set({ status: "reopened", reopenedBy: input.actorId, reopenedAt: now, reopenReason: input.reason, reopenCount: sql`${entityClosures.reopenCount} + 1`, updatedAt: now })
      .where(and(eq(entityClosures.tenantId, input.tenantId), eq(entityClosures.entityType, input.entityType), eq(entityClosures.entityId, input.entityId), eq(entityClosures.status, "closed")))
      .returning();
    if (res.length === 0) return null;
    await audit(tx as Tx, input.tenantId, input.actorId, input.correlationId, "entity_reopened", input.entityType, input.entityId, { reopenCount: res[0]!.reopenCount });
    return res[0]!;
  });
}

export async function archive(input: { tenantId: string; entityType: string; entityId: string; actorId: string; correlationId: string }): Promise<ClosureRow | null> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const res = await tx.update(entityClosures)
      .set({ status: "archived", archivedBy: input.actorId, archivedAt: now, updatedAt: now })
      .where(and(eq(entityClosures.tenantId, input.tenantId), eq(entityClosures.entityType, input.entityType), eq(entityClosures.entityId, input.entityId), eq(entityClosures.status, "closed")))
      .returning();
    if (res.length === 0) return null;
    await audit(tx as Tx, input.tenantId, input.actorId, input.correlationId, "entity_archived", input.entityType, input.entityId, {});
    return res[0]!;
  });
}
