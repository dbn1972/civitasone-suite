import type { Queue } from "@civitasone/queue";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsOutsourcedContracts as t } from "./schema.js";
import type { CreateOutsourcedBody, UpdateOutsourcedBody } from "./validators.js";

const AUDIT = "audit.event.record";

type CreatePayload = CreateOutsourcedBody & { id: string; tenantId: string };
type UpdatePayload = UpdateOutsourcedBody & { id: string; tenantId: string };

/**
 * GAP-HR-OUTSOURCED-01: applies the queued register writes. Each handler is ONE
 * transaction: idempotency mark + the write + its audit.event.record outbox row, so
 * a decision can never exist without its audit trail (or the reverse).
 */
export function registerOutsourcedConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.outsourcedCreate, async (msg) => {
    const p = msg.payload as CreatePayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(t).values({
        id: p.id, tenantId: p.tenantId,
        vendorName: p.vendorName, serviceCategory: p.serviceCategory,
        contractRef: p.contractRef ?? null, headcount: p.headcount,
        contractStart: p.contractStart, contractEnd: p.contractEnd,
        contractValueMinor: BigInt(p.contractValueMinor),
        remarks: p.remarks ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "hrms", action: "create", resourceType: "outsourced_contract", resourceId: p.id, outcome: "success",
          metadata: { vendorName: p.vendorName, headcount: p.headcount, contractValueMinor: p.contractValueMinor },
        },
      });
    });
  });

  queue.subscribe(COMMANDS.outsourcedUpdate, async (msg) => {
    const p = msg.payload as UpdatePayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const set: Record<string, unknown> = { updatedBy: msg.actorId, updatedAt: sql`now()`, version: sql`${t.version} + 1` };
      if (p.headcount !== undefined) set.headcount = p.headcount;
      if (p.contractEnd !== undefined) set.contractEnd = p.contractEnd;
      if (p.contractValueMinor !== undefined) set.contractValueMinor = BigInt(p.contractValueMinor);
      if (p.status !== undefined) set.status = p.status;
      // Append (never overwrite) so earlier remarks survive a later terminate/update reason.
      if (p.remarks !== undefined) set.remarks = sql`CASE WHEN ${t.remarks} IS NULL OR ${t.remarks} = '' THEN ${p.remarks} ELSE ${t.remarks} || E'\n' || ${p.remarks} END`;
      // Conditional update: a terminated contract is final (cannot be silently
      // re-activated or edited by a stale/concurrent command) -- 0 rows is a no-op.
      const updated = await tx.update(t).set(set)
        .where(and(eq(t.id, p.id), eq(t.tenantId, p.tenantId), eq(t.status, "active")))
        .returning({ id: t.id });
      if (updated.length === 0) return;
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "hrms", action: p.status === "terminated" ? "terminate" : "update",
          resourceType: "outsourced_contract", resourceId: p.id, outcome: "success",
          metadata: { fields: Object.keys(p).filter((k) => k !== "id" && k !== "tenantId") },
        },
      });
    });
  });
}
