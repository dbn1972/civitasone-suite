import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "crm-roles-consumer" });
const AUDIT = "audit.event.record";

export function registerContactRoleConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.createContactRole, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; contactId: string; dealId: string; role: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          INSERT INTO crm.contact_roles (id, tenant_id, contact_id, deal_id, role, created_by)
          VALUES (${p.id}, ${p.tenantId}, ${p.contactId}, ${p.dealId}, ${p.role}, ${msg.actorId})
        `);
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "crm", action: "contact_role_create", resourceType: "contact_role", resourceId: p.id, outcome: "success" },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "createContactRole failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.deleteContactRole, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; contactId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          DELETE FROM crm.contact_roles
          WHERE id = ${p.id} AND contact_id = ${p.contactId} AND tenant_id = ${p.tenantId}
        `);
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "crm", action: "contact_role_delete", resourceType: "contact_role", resourceId: p.id, outcome: "success" },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "deleteContactRole failed");
      throw err;
    }
  });
}
