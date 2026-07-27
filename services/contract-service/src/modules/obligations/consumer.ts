import type { Queue } from "@civitasone/queue";
import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { contractObligations } from "./schema.js";
import { validateStatusTransition, type ObligationStatus } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

async function audit(tx: unknown, msg: any, action: string, resourceId: string): Promise<void> {
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "contract", action, resourceType: "obligation", resourceId, outcome: "success" },
  });
}

export function registerObligationConsumers(q: Queue): void {
  q.subscribe(COMMANDS.obligationCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; contractId: string; title: string;
      description: string; dueDate: string; ownerId: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await tx.insert(contractObligations).values({
        id: p.id,
        tenantId: msg.tenantId,
        contractId: p.contractId,
        title: p.title,
        description: p.description,
        dueDate: p.dueDate,
        ownerId: p.ownerId,
        status: "pending",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: EVENTS.obligationCreated, eventType: EVENTS.obligationCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, tenantId: msg.tenantId, contractId: p.contractId, title: p.title, dueDate: p.dueDate },
      });
      await audit(tx, msg, "create", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "obligation", "list"));
  });

  q.subscribe(COMMANDS.obligationUpdate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; version: number;
      title?: string; description?: string; dueDate?: string;
      ownerId?: string; status?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const [existing] = await tx
        .select()
        .from(contractObligations)
        .where(and(eq(contractObligations.id, p.id), eq(contractObligations.tenantId, msg.tenantId)))
        .limit(1);
      if (!existing) return;

      if (p.status && p.status !== existing.status) {
        if (!validateStatusTransition(existing.status as ObligationStatus, p.status as ObligationStatus)) return;
      }

      const updates: Record<string, unknown> = {
        updatedBy: msg.actorId,
        updatedAt: new Date(),
        version: p.version + 1,
      };
      if (p.title !== undefined) updates.title = p.title;
      if (p.description !== undefined) updates.description = p.description;
      if (p.dueDate !== undefined) updates.dueDate = p.dueDate;
      if (p.ownerId !== undefined) updates.ownerId = p.ownerId;
      if (p.status !== undefined) updates.status = p.status;

      const [updated] = await tx
        .update(contractObligations)
        .set(updates as any)
        .where(
          and(
            eq(contractObligations.id, p.id),
            eq(contractObligations.tenantId, msg.tenantId),
            eq(contractObligations.version, p.version),
          ),
        )
        .returning();

      if (!updated) return;

      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: EVENTS.obligationUpdated, eventType: EVENTS.obligationUpdated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, tenantId: msg.tenantId, contractId: existing.contractId, version: p.version + 1 },
      });
      await audit(tx, msg, "update", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "obligation", p.id));
  });
}
