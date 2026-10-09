import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { dltTemplates } from "./schema.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * GAP2-NOTIFICATIONS-DLT-10: the ONLY code allowed to write dlt_templates.
 * Each handler applies the mutation and emits a domain event + an audit event
 * through the transactional outbox in the SAME transaction, so a regulated
 * DLT (TRAI) template change always leaves an audit trail — the route no
 * longer writes directly and emitted no audit event.
 */
export function registerDltConsumers(q: Queue): void {
  // RLS: every handler must run inside the message's tenant context.
  q = tenantScoped(q);

  q.subscribe<{
    id: string; tenantId: string; entityId: string; templateId: string; headerId: string;
    contentType: string; templateBody: string; channel: string; status?: string;
    registeredAt?: string; expiresAt?: string;
  }>(COMMANDS.createDltTemplate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      try {
        await tx.insert(dltTemplates).values({
          id: p.id,
          tenantId: p.tenantId,
          entityId: p.entityId,
          templateId: p.templateId,
          headerId: p.headerId,
          contentType: p.contentType,
          templateBody: p.templateBody,
          channel: p.channel,
          status: p.status ?? "active",
          registeredAt: p.registeredAt ? new Date(p.registeredAt) : null,
          expiresAt: p.expiresAt ? new Date(p.expiresAt) : null,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
          version: 1,
        });
      } catch (err: unknown) {
        if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "23505") {
          throw new NonRetryableError("DLT_TEMPLATE_EXISTS", "DLT template already registered for this tenant/channel");
        }
        throw err;
      }

      await enqueue(tx, {
        topic: EVENTS.dltTemplateRegistered,
        eventType: EVENTS.dltTemplateRegistered,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { dltTemplateId: p.id, templateId: p.templateId, channel: p.channel },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "notification", action: "register_dlt_template", resourceType: "dlt_template", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "dlt_templates_list", msg.tenantId));
  });

  q.subscribe<{
    id: string; tenantId: string; status?: string; expiresAt?: string | null;
  }>(COMMANDS.updateDltTemplate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;

      const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: msg.actorId };
      if (p.status !== undefined) set.status = p.status;
      if (p.expiresAt !== undefined) set.expiresAt = p.expiresAt === null ? null : new Date(p.expiresAt);

      const updated = await tx.update(dltTemplates).set(set)
        .where(and(eq(dltTemplates.id, p.id), eq(dltTemplates.tenantId, p.tenantId)))
        .returning();
      if (updated.length === 0) {
        // Row vanished between the route pre-check and this apply — nothing to
        // do, but do not emit an audit event for a mutation that did not happen.
        return;
      }

      await enqueue(tx, {
        topic: EVENTS.dltTemplateUpdated,
        eventType: EVENTS.dltTemplateUpdated,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { dltTemplateId: p.id, status: p.status ?? null },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "notification", action: "update_dlt_template", resourceType: "dlt_template", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "dlt_templates_list", msg.tenantId));
  });

  q.subscribe<{ id: string; tenantId: string }>(COMMANDS.deleteDltTemplate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;

      const deleted = await tx.delete(dltTemplates)
        .where(and(eq(dltTemplates.id, p.id), eq(dltTemplates.tenantId, p.tenantId)))
        .returning();
      if (deleted.length === 0) return;

      await enqueue(tx, {
        topic: EVENTS.dltTemplateDeleted,
        eventType: EVENTS.dltTemplateDeleted,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { dltTemplateId: p.id },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "notification", action: "delete_dlt_template", resourceType: "dlt_template", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "dlt_templates_list", msg.tenantId));
  });
}
