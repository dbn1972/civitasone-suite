import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";

export function registerAlertConsumers(q: Queue): void {
  q.subscribe<{
    id: string; tenantId: string; name: string; triggerEvent: string;
    conditions: Record<string, unknown>; channel: string; recipients: string[];
  }>(COMMANDS.createAlertRule, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insertRule(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name, triggerEvent: p.triggerEvent,
        conditions: p.conditions, channel: p.channel, recipients: p.recipients,
        enabled: true, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: EVENTS.alertRuleCreated, eventType: EVENTS.alertRuleCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { ruleId: p.id },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE.alertRule, "list"));
  });

  q.subscribe<{ id: string; enabled: boolean }>(COMMANDS.enableAlertRule, async (msg) => {
    await handleEnableToggle(msg, true);
  });

  q.subscribe<{ id: string; enabled: boolean }>(COMMANDS.disableAlertRule, async (msg) => {
    await handleEnableToggle(msg, false);
  });
}

async function handleEnableToggle(msg: { messageId: string; tenantId: string; actorId: string; correlationId: string; payload: { id: string } }, enabled: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    await repo.setRuleEnabled(tx, msg.payload.id, enabled, msg.actorId);
  });
  await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE.alertRule, msg.payload.id));
  await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE.alertRule, "list"));
}
