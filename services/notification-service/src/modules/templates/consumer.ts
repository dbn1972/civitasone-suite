import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import { planTemplateVersion } from "./versioning.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerTemplateConsumers(q: Queue): void {
  q.subscribe<{ id: string; tenantId: string; channel: string; name: string; subject?: string; body: string }>(
    COMMANDS.createTemplate, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await repo.insertTemplate(tx, {
          id: p.id, tenantId: p.tenantId, channel: p.channel, name: p.name,
          subject: p.subject ?? null, body: p.body, status: "active",
          createdBy: msg.actorId, updatedBy: msg.actorId, version: 1, supersededBy: null,
        });
        await emitAudit(tx, msg, EVENTS.templateCreated, { templateId: p.id }, "create", p.id);
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, `${RESOURCE.template}_list`, msg.tenantId));
    },
  );

  q.subscribe<{
    id: string; tenantId: string; templateId: string;
    channel?: string; name?: string; subject?: string; body?: string;
  }>(COMMANDS.updateTemplate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const old = await repo.findTemplateByIdTx(tx, p.templateId);
      if (!old) return;
      const plan = planTemplateVersion(old, p.id);
      await repo.insertTemplate(tx, {
        id: p.id, tenantId: old.tenantId, channel: p.channel ?? old.channel,
        name: p.name ?? old.name, subject: p.subject ?? old.subject, body: p.body ?? old.body,
        status: "active", createdBy: msg.actorId, updatedBy: msg.actorId,
        version: plan.version, supersededBy: null,
      });
      await repo.supersedeTemplate(tx, old.id, p.id, msg.actorId);
      await emitAudit(tx, msg, EVENTS.templateUpdated, { templateId: p.id, previousId: old.id, version: plan.version }, "update", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE.template, msg.payload.templateId));
    await cache.invalidate(cache.makeKey(msg.tenantId, `${RESOURCE.template}_versions`, msg.payload.templateId));
    await cache.invalidate(cache.makeKey(msg.tenantId, `${RESOURCE.template}_list`, msg.tenantId));
  });

  q.subscribe<{ id: string; tenantId: string; userId: string; eventType: string; inApp: boolean; email: boolean; push: boolean }>(
    COMMANDS.setPrefs, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await repo.upsertPrefs(tx, {
          id: p.id, tenantId: p.tenantId, userId: p.userId, eventType: p.eventType,
          inApp: p.inApp, email: p.email, push: p.push,
          createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
        });
        await emitAudit(tx, msg, EVENTS.prefSet, { userId: p.userId, eventType: p.eventType }, "set_prefs", p.id);
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE.prefs, msg.payload.userId));
    },
  );
}

async function emitAudit(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "notification", action, resourceType: "template", resourceId, outcome: "success" } });
}
