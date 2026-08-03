import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import { planTemplateVersion } from "./versioning.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerTemplateConsumers(q: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  q = tenantScoped(q);
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

  q.subscribe<{
    id: string; tenantId: string; userId: string; eventType: string;
    inApp: boolean; email: boolean; push: boolean; sms?: boolean; whatsapp?: boolean;
  }>(
    COMMANDS.setPrefs, async (msg) => {
      const p = msg.payload;
      if (typeof p.inApp !== "boolean" || typeof p.email !== "boolean" || typeof p.push !== "boolean") {
        throw new NonRetryableError("INVALID_PREFS_PAYLOAD", "Missing required boolean fields: inApp, email, push");
      }
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.upsertPrefs(tx, {
          id: p.id, tenantId: p.tenantId, userId: p.userId, eventType: p.eventType,
          inApp: p.inApp, email: p.email, push: p.push,
          // A command from an older producer omits the commercial channels; the
          // fail-closed default (no consent) is the only safe interpretation.
          sms: p.sms ?? false, whatsapp: p.whatsapp ?? false,
          createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
        });
        await emitAudit(tx, msg, EVENTS.prefSet, { userId: p.userId, eventType: p.eventType }, "set_prefs", p.id);
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE.prefs, msg.payload.userId));
    },
  );

  q.subscribe<{
    id: string; tenantId: string; prefId: string;
    inApp?: boolean; email?: boolean; push?: boolean; sms?: boolean; whatsapp?: boolean;
  }>(
    COMMANDS.updatePrefs, async (msg) => {
      let changed = 0;
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        changed = await repo.updatePrefsById(
          tx, p.tenantId, p.prefId,
          { inApp: p.inApp, email: p.email, push: p.push, sms: p.sms, whatsapp: p.whatsapp },
          msg.actorId,
        );
        // Audit the admin pref change. (changed===0 means the row vanished
        // between the route's existence check and the consumer; still record the
        // attempt so the audit trail is complete.)
        await emitAudit(tx, msg, EVENTS.prefSet, { prefId: p.prefId, changed }, "update_prefs", p.prefId);
      });
      if (changed > 0) {
        // The tenant prefs listing (default page limit 50) is read-through cached;
        // drop it so a refresh reflects the new channel state.
        await cache.invalidate(cache.makeKey(msg.tenantId, `${RESOURCE.prefs}_list`, "50"));
      }
    },
  );
}

async function emitAudit(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "notification", action, resourceType: "template", resourceId, outcome: "success" } });
}
