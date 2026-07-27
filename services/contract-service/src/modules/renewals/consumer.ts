import type { Queue } from "@civitasone/queue";
import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { contractRenewals } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

async function audit(tx: unknown, msg: any, action: string, resourceId: string): Promise<void> {
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "contract", action, resourceType: "renewal", resourceId, outcome: "success" },
  });
}

export function registerRenewalConsumers(q: Queue): void {
  q.subscribe(COMMANDS.renewalCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; contractId: string;
      expiryDate: string; advanceNoticeDays: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await tx.insert(contractRenewals).values({
        id: p.id,
        tenantId: msg.tenantId,
        contractId: p.contractId,
        expiryDate: p.expiryDate,
        advanceNoticeDays: p.advanceNoticeDays,
        status: "active",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: EVENTS.renewalCreated, eventType: EVENTS.renewalCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, tenantId: msg.tenantId, contractId: p.contractId, expiryDate: p.expiryDate },
      });
      await audit(tx, msg, "create", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "renewal", "list"));
  });

  q.subscribe(COMMANDS.renewalUpdate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; version: number;
      advanceNoticeDays?: number; status?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const updates: Record<string, unknown> = {
        updatedBy: msg.actorId,
        updatedAt: new Date(),
        version: p.version + 1,
      };
      if (p.advanceNoticeDays !== undefined) updates.advanceNoticeDays = p.advanceNoticeDays;
      if (p.status !== undefined) {
        updates.status = p.status;
        if (p.status === "renewed") {
          updates.renewedAt = new Date();
          updates.renewedBy = msg.actorId;
        }
      }

      const [updated] = await tx
        .update(contractRenewals)
        .set(updates as any)
        .where(
          and(
            eq(contractRenewals.id, p.id),
            eq(contractRenewals.tenantId, msg.tenantId),
            eq(contractRenewals.version, p.version),
          ),
        )
        .returning();

      if (!updated) return;

      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: EVENTS.renewalUpdated, eventType: EVENTS.renewalUpdated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, tenantId: msg.tenantId, contractId: updated.contractId, version: p.version + 1 },
      });
      await audit(tx, msg, "update", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "renewal", p.id));
  });
}
