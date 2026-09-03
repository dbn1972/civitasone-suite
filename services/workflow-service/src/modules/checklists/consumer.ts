import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { toggleItem, type ChecklistItem } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

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
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow-service", action: "upsert", resourceType: "checklist_template", resourceId: p.id, outcome: "success" } });
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
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow-service", action: "create", resourceType: "checklist_instance", resourceId: p.id, outcome: "success" } });
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
        // Row-locked read (see findInstanceForUpdate doc): without this lock,
        // two toggle commands for the same instance delivered close together
        // each read the same stale items array and the second saveItems()
        // overwrote the first toggle -- a silent lost update. Locking here
        // serializes them so the second toggle always builds on the first
        // toggle's already-committed items.
        const inst = await repo.findInstanceForUpdate(p.tenantId, p.instanceId, tx);
        if (!inst) return;
        const res = toggleItem(inst.items as ChecklistItem[], p.key, p.checked, msg.actorId, new Date().toISOString());
        if (!res.found) return;
        await repo.saveItems(p.tenantId, p.instanceId, res.items, tx);
        await enqueue(tx, {
          topic: EVENTS.checklistItemToggled, eventType: EVENTS.checklistItemToggled,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { instanceId: p.instanceId, key: p.key, checked: p.checked },
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow-service", action: "process", resourceType: "checklists", resourceId: msg.messageId, outcome: "success" } });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "toggleChecklistItem failed");
      throw err;
    }
  });
}
