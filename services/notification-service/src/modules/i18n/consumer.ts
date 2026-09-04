import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerI18nConsumers(q: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  q = tenantScoped(q);
  q.subscribe<{
    id: string; tenantId: string; templateId: string;
    locale: string; subject?: string; body: string;
  }>(COMMANDS.createLocaleVariant, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;

      // Check for duplicate (template + locale). Reads through the already-open
      // `tx` (not `repo.findVariant`'s `scopedRead`) to avoid opening a second,
      // nested transaction on this same connection-pool deadlock shape -- see
      // `findVariantInTx` in `./repo.ts`.
      const existing = await repo.findVariantInTx(tx, p.tenantId, p.templateId, p.locale);
      if (existing) return; // idempotent — already exists

      await repo.insertVariant(tx, {
        id: p.id,
        tenantId: p.tenantId,
        templateId: p.templateId,
        locale: p.locale,
        subject: p.subject ?? null,
        body: p.body,
        status: "current",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });

      await enqueue(tx, {
        topic: EVENTS.localeVariantCreated,
        eventType: EVENTS.localeVariantCreated,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { variantId: p.id, templateId: p.templateId, locale: p.locale },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "notification", action: "create_locale_variant", resourceType: "locale_variant", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "i18n_variants", msg.payload.templateId));
  });

  q.subscribe<{
    id: string; tenantId: string; subject?: string; body?: string; status?: string;
  }>(COMMANDS.updateLocaleVariant, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;

      await repo.updateVariant(tx, p.id, p.tenantId, {
        ...(p.subject !== undefined ? { subject: p.subject } : {}),
        ...(p.body !== undefined ? { body: p.body } : {}),
        ...(p.status !== undefined ? { status: p.status } : {}),
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "notification", action: "update_locale_variant", resourceType: "locale_variant", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "i18n_variants", msg.payload.id));
  });
}

/**
 * Called when a base template is updated — flags all locale variants as "needs_review".
 * This is invoked from the template update consumer or via an event.
 */
export async function flagVariantsOnBaseUpdate(
  tenantId: string, templateId: string, actorId: string,
): Promise<number> {
  let flagged = 0;
  await db.transaction(async (tx) => {
    flagged = await repo.flagStaleVariants(tx, tenantId, templateId, actorId);
  });
  if (flagged > 0) {
    await cache.invalidate(cache.makeKey(tenantId, "i18n_variants", templateId));
  }
  return flagged;
}
