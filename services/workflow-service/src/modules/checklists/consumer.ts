import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { toggleItem, type ChecklistItem } from "./domain.js";

const log = pino({ name: "workflow-checklists-consumer" });

export function registerChecklistConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.upsertChecklistTemplate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; code: string; name: string;
      items: Array<{ key: string; label: string; required?: boolean }>;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.upsertTemplate({
          id: p.id, tenantId: p.tenantId, code: p.code, name: p.name, items: p.items, actorId: msg.actorId,
        }, tx);
        await enqueue(tx, {
          topic: EVENTS.checklistTemplateUpserted, eventType: EVENTS.checklistTemplateUpserted,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { id: p.id, code: p.code },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "upsertChecklistTemplate failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.createChecklistInstance, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; templateId: string; entityType: string; entityId: string;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const row = await repo.createInstance({
          id: p.id, tenantId: p.tenantId, templateId: p.templateId,
          entityType: p.entityType, entityId: p.entityId, actorId: msg.actorId,
        }, tx);
        if (!row) {
          log.warn({ messageId: msg.messageId }, "createChecklistInstance template missing");
          return;
        }
        await enqueue(tx, {
          topic: EVENTS.checklistInstanceCreated, eventType: EVENTS.checklistInstanceCreated,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { id: p.id, templateId: p.templateId },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "createChecklistInstance failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.toggleChecklistItem, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; instanceId: string; key: string; checked: boolean;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const inst = await repo.findInstance(p.tenantId, p.instanceId);
        if (!inst) return;
        const res = toggleItem(inst.items as ChecklistItem[], p.key, p.checked, msg.actorId, new Date().toISOString());
        if (!res.found) return;
        await repo.saveItems(p.tenantId, p.instanceId, res.items, tx);
        await enqueue(tx, {
          topic: EVENTS.checklistItemToggled, eventType: EVENTS.checklistItemToggled,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { instanceId: p.instanceId, key: p.key, checked: p.checked },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "toggleChecklistItem failed");
      throw err;
    }
  });
}
