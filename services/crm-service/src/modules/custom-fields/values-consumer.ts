/**
 * Consumer for the custom-field value store (GAP-CRM-CUSTOM-FIELDS-01, owner decision C10).
 * One command writes every changed value of one record in ONE transaction, with ONE audit event
 * that carries field ids only (never a value, sensitive or not).
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "crm-custom-field-values-consumer" });
const AUDIT = "audit.event.record";

interface Payload {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  sets: Array<{ fieldId: string; value: unknown }>;
  clears: string[];
}

export function registerCustomFieldValueConsumers(q: Queue): void {
  q.subscribe<Payload>(COMMANDS.setCustomFieldValues, async (msg) => {
    const p = msg.payload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        for (const s of p.sets) {
          // The definition must still exist in this tenant and entity type (it may have been
          // deleted between the route check and now); otherwise the value would be orphaned.
          await tx.execute(sql`
            INSERT INTO crm.custom_field_values
              (tenant_id, field_id, entity_type, entity_id, value, created_by, updated_by)
            SELECT ${p.tenantId}, f.id, ${p.entityType}, ${p.entityId}, ${JSON.stringify(s.value)}::jsonb,
                   ${msg.actorId}, ${msg.actorId}
            FROM crm.custom_fields f
            WHERE f.id = ${s.fieldId} AND f.tenant_id = ${p.tenantId} AND f.entity_type = ${p.entityType}
            ON CONFLICT (tenant_id, field_id, entity_id) DO UPDATE
            SET value = EXCLUDED.value, updated_at = now(), updated_by = ${msg.actorId},
                version = crm.custom_field_values.version + 1
          `);
        }
        for (const fieldId of p.clears) {
          await tx.execute(sql`
            DELETE FROM crm.custom_field_values
            WHERE tenant_id = ${p.tenantId} AND field_id = ${fieldId} AND entity_id = ${p.entityId}
          `);
        }
        await enqueue(tx, {
          topic: AUDIT,
          eventType: AUDIT,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "crm",
            action: "custom_field_values_set",
            resourceType: p.entityType,
            resourceId: p.entityId,
            outcome: "success",
            fieldIds: [...p.sets.map((s) => s.fieldId), ...p.clears],
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "setCustomFieldValues failed");
      throw err;
    }
  });
}
