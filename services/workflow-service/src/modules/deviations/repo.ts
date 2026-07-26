import { randomUUID } from "node:crypto";
import { and, eq, desc, sql } from "drizzle-orm";
import { db, scopedRead, type Db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { deviationRequests, type DeviationRow } from "./schema.js";
import type { DeviationState, DeviationStatus } from "./domain.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function toState(row: DeviationRow): DeviationState {
  return {
    status: row.status as DeviationStatus,
    requestedBy: row.requestedBy,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  };
}

export async function find(tenantId: string, id: string): Promise<DeviationRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(deviationRequests)
    .where(and(eq(deviationRequests.tenantId, tenantId), eq(deviationRequests.id, id))).limit(1));
  return rows[0];
}

export async function listForEntity(tenantId: string, entityType: string, entityId: string): Promise<DeviationRow[]> {
  return scopedRead((tx) => tx.select().from(deviationRequests)
    .where(and(eq(deviationRequests.tenantId, tenantId), eq(deviationRequests.entityType, entityType), eq(deviationRequests.entityId, entityId)))
    .orderBy(desc(deviationRequests.createdAt)));
}

/** CAP-039 — the register of currently-active (approved, unexpired) waivers. */
export async function listActive(tenantId: string): Promise<DeviationRow[]> {
  return scopedRead((tx) => tx.select().from(deviationRequests)
    .where(and(
      eq(deviationRequests.tenantId, tenantId),
      eq(deviationRequests.status, "approved"),
      sql`(${deviationRequests.expiresAt} IS NULL OR ${deviationRequests.expiresAt} > now())`,
    ))
    .orderBy(desc(deviationRequests.createdAt)));
}

export interface RaiseInput {
  tenantId: string; entityType: string; entityId: string; deviationType: string;
  reason: string; expiresAt?: Date | null; actorId: string; correlationId: string;
}

export async function raise(input: RaiseInput): Promise<DeviationRow> {
  const id = randomUUID();
  return db.transaction(async (tx) => {
    const insRows = await tx.insert(deviationRequests).values({
      id, tenantId: input.tenantId, entityType: input.entityType, entityId: input.entityId,
      deviationType: input.deviationType, reason: input.reason, status: "pending",
      requestedBy: input.actorId, expiresAt: input.expiresAt ?? null,
    }).returning();
    await audit(tx as Tx, input.tenantId, input.actorId, input.correlationId, "raise_deviation", id, { entityType: input.entityType, entityId: input.entityId });
    return insRows[0]!;
  });
}

export interface ReviewInput {
  tenantId: string; id: string; status: DeviationStatus; reviewerId: string;
  note?: string | undefined; correlationId: string;
}

/** Apply an approve/reject decision. Conditional UPDATE keeps it idempotent
 *  under concurrency (only a still-pending row transitions). */
export async function review(input: ReviewInput): Promise<DeviationRow | null> {
  return db.transaction(async (tx) => {
    const res = await tx.update(deviationRequests)
      .set({ status: input.status, reviewedBy: input.reviewerId, reviewedAt: new Date(), reviewNote: input.note ?? null, updatedAt: new Date() })
      .where(and(eq(deviationRequests.tenantId, input.tenantId), eq(deviationRequests.id, input.id), eq(deviationRequests.status, "pending")))
      .returning();
    if (res.length === 0) return null;
    await audit(tx as Tx, input.tenantId, input.reviewerId, input.correlationId, `deviation_${input.status}`, input.id, { note: input.note });
    return res[0]!;
  });
}

export async function revoke(tenantId: string, id: string, actorId: string, correlationId: string): Promise<DeviationRow | null> {
  return db.transaction(async (tx) => {
    const res = await tx.update(deviationRequests)
      .set({ status: "revoked", updatedAt: new Date() })
      .where(and(eq(deviationRequests.tenantId, tenantId), eq(deviationRequests.id, id), eq(deviationRequests.status, "approved")))
      .returning();
    if (res.length === 0) return null;
    await audit(tx as Tx, tenantId, actorId, correlationId, "deviation_revoked", id, {});
    return res[0]!;
  });
}

async function audit(tx: Tx, tenantId: string, actorId: string, correlationId: string, action: string, id: string, detail: Record<string, unknown>): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId, actorId, correlationId,
    payload: { service: "workflow", action, resourceType: "deviation", resourceId: id, outcome: "success", detail },
  });
}
