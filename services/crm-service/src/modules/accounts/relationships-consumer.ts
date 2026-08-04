/**
 * CM-002 account-relationships consumer. Idempotent (markProcessed) + a unique edge
 * index makes the INSERT safe under redelivery (ON CONFLICT DO NOTHING).
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const log = pino({ name: "crm-account-relationships-consumer" });
const AUDIT = "audit.event.record";

export function registerAccountRelationshipConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.createAccountRelationship, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; fromAccountId: string; toAccountId: string; relType: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          INSERT INTO crm.account_relationships (id, tenant_id, from_account_id, to_account_id, rel_type, created_by)
          VALUES (${p.id}, ${p.tenantId}, ${p.fromAccountId}, ${p.toAccountId}, ${p.relType}, ${msg.actorId})
          ON CONFLICT (tenant_id, from_account_id, to_account_id, rel_type) DO NOTHING
        `);
        await enqueue(tx, {
          topic: EVENTS.accountRelationshipCreated, eventType: EVENTS.accountRelationshipCreated,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { relationshipId: p.id, fromAccountId: p.fromAccountId, toAccountId: p.toAccountId, relType: p.relType },
        });
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "crm", action: "account_relationship_create", resourceType: "account_relationship", resourceId: p.id, outcome: "success" },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "createAccountRelationship failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.deleteAccountRelationship, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; fromAccountId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          DELETE FROM crm.account_relationships
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId} AND from_account_id = ${p.fromAccountId}
        `);
        await enqueue(tx, {
          topic: EVENTS.accountRelationshipDeleted, eventType: EVENTS.accountRelationshipDeleted,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { relationshipId: p.id },
        });
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "crm", action: "account_relationship_delete", resourceType: "account_relationship", resourceId: p.id, outcome: "success" },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "deleteAccountRelationship failed");
      throw err;
    }
  });
}
