import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "crm-custom-fields-consumer" });
const RESOURCE = "custom_field";
const AUDIT = "audit.event.record";

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceId: string,
) {
  await enqueue(tx, {
    topic: AUDIT,
    eventType: AUDIT,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "crm", action, resourceType: RESOURCE, resourceId, outcome: "success" },
  });
}

export function registerCustomFieldConsumers(q: Queue): void {
  q.subscribe<{
    id: string; tenantId: string; entityType: string; fieldName: string; fieldType: string;
    validationSchema: unknown; ordinal: number; createdBy: string; updatedBy: string;
  }>(COMMANDS.createCustomField, async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await repo.insert(tx, {
          id: p.id,
          tenantId: p.tenantId,
          entityType: p.entityType,
          fieldName: p.fieldName,
          fieldType: p.fieldType,
          validationSchema: p.validationSchema ?? null,
          ordinal: p.ordinal,
          createdBy: p.createdBy,
          updatedBy: p.updatedBy,
        });
        await enqueue(tx, {
          topic: EVENTS.customFieldCreated,
          eventType: EVENTS.customFieldCreated,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { id: p.id, tenantId: p.tenantId, entityType: p.entityType },
        });
        await audit(tx, msg, "custom_field_create", p.id);
      });
      await cache.invalidateResource(msg.payload.tenantId, RESOURCE);
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "createCustomField failed");
      throw err;
    }
  });

  q.subscribe<{
    id: string; tenantId: string; fieldName?: string; fieldType?: string;
    validationSchema?: unknown; ordinal?: number; updatedBy: string;
  }>(COMMANDS.updateCustomField, async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await repo.update(
          tx,
          p.id,
          p.tenantId,
          {
            fieldName: p.fieldName,
            fieldType: p.fieldType,
            validationSchema: p.validationSchema,
            ordinal: p.ordinal,
          },
          p.updatedBy,
        );
        await enqueue(tx, {
          topic: EVENTS.customFieldUpdated,
          eventType: EVENTS.customFieldUpdated,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { id: p.id, tenantId: p.tenantId },
        });
        await audit(tx, msg, "custom_field_update", p.id);
      });
      await cache.invalidateResource(msg.payload.tenantId, RESOURCE);
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "updateCustomField failed");
      throw err;
    }
  });

  q.subscribe<{ id: string; tenantId: string }>(COMMANDS.deleteCustomField, async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await repo.remove(tx, p.id, p.tenantId);
        await enqueue(tx, {
          topic: EVENTS.customFieldDeleted,
          eventType: EVENTS.customFieldDeleted,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { id: p.id, tenantId: p.tenantId },
        });
        await audit(tx, msg, "custom_field_delete", p.id);
      });
      await cache.invalidateResource(msg.payload.tenantId, RESOURCE);
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "deleteCustomField failed");
      throw err;
    }
  });
}
