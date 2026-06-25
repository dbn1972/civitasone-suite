import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as contactRepo from "../contacts/repo.js";
import * as dealRepo from "../deals/repo.js";
import { invalidateDashboard } from "../dashboard/queries.js";
import type { ActivityView } from "./schema.js";

const RESOURCE = "activity";
const AUDIT_TOPIC = "audit.event.record";

export function registerActivityConsumers(queue: Queue): void {
  queue.subscribe<ActivityView>(COMMANDS.createActivity, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      // P0-1 cross-tenant FK guards: any referenced contact/deal must live here.
      if (p.contactId && !(await contactRepo.contactExists(p.tenantId, p.contactId))) {
        await emitAudit(tx, msg, "create", p.id, "rejected_cross_tenant_contact");
        return;
      }
      if (p.dealId && !(await dealRepo.dealExists(p.tenantId, p.dealId))) {
        await emitAudit(tx, msg, "create", p.id, "rejected_cross_tenant_deal");
        return;
      }
      await repo.insert(tx, {
        id: p.id, tenantId: p.tenantId, actorName: p.actorName, text: p.text,
        contactId: p.contactId, dealId: p.dealId,
        type: p.type, subject: p.subject, status: p.status,
        dueDate: p.dueDate,
        completedAt: p.completedAt ? new Date(p.completedAt) : null,
        createdBy: msg.actorId,
      });
      if (p.contactId) await contactRepo.touchLastActivity(tx, p.contactId, p.tenantId);
      await emit(tx, msg, EVENTS.activityCreated, { activityId: p.id, contactId: p.contactId }, "create", p.id);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE);
    // A new activity increments activitiesToday (and, via touchLastActivity,
    // can move a contact into the "recent" segment) — drop the cached summary.
    await invalidateDashboard(msg.tenantId);
    if (msg.payload.contactId) {
      await cache.invalidate(cache.makeKey(msg.tenantId, "contact", msg.payload.contactId));
      await cache.invalidateResource(msg.tenantId, "contact");
    }
  });

  queue.subscribe(COMMANDS.updateActivity, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; status?: string; completedAt?: string | null };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const fields: Parameters<typeof repo.updateActivity>[3] = {};
      if (p.status !== undefined) fields.status = p.status;
      if (p.completedAt !== undefined) fields.completedAt = p.completedAt ? new Date(p.completedAt) : null;
      await repo.updateActivity(tx, p.id, p.tenantId, fields);
      await emit(tx, msg, EVENTS.activityUpdated, { activityId: p.id, status: p.status }, "update", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE, p.id));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });
}

async function emit(
  tx: unknown,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType, eventType,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "crm", action, resourceType: "activity", resourceId, outcome: "success" },
  });
}

/** Audit-only emit (no domain event) — used for rejected/validation outcomes. */
async function emitAudit(
  tx: unknown,
  msg: CommandEnvelope,
  action: string,
  resourceId: string,
  outcome: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "crm", action, resourceType: "activity", resourceId, outcome },
  });
}
