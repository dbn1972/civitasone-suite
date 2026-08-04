/**
 * AC-004 linking-substrate consumer (framework). Idempotent (markProcessed);
 * unique indexes make connect/link safe under redelivery. No live provider I/O.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const log = pino({ name: "crm-integrations-consumer" });
const AUDIT = "audit.event.record";

export function registerIntegrationConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.connectLinkedAccount, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; userId: string; provider: string; externalEmail: string; scopes: string[] };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          INSERT INTO crm.linked_accounts (id, tenant_id, user_id, provider, external_email, status, scopes, created_by)
          VALUES (${p.id}, ${p.tenantId}, ${p.userId}, ${p.provider}, ${p.externalEmail}, 'pending',
                  ${JSON.stringify(p.scopes ?? [])}::jsonb, ${msg.actorId})
          ON CONFLICT (tenant_id, user_id, provider, external_email) DO NOTHING
        `);
        await enqueue(tx, {
          topic: EVENTS.linkedAccountConnected, eventType: EVENTS.linkedAccountConnected,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { linkedAccountId: p.id, provider: p.provider, status: "pending" },
        });
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "crm", action: "linked_account_connect", resourceType: "linked_account", resourceId: p.id, outcome: "success" },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "connectLinkedAccount failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.disconnectLinkedAccount, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // Removing the link removes its synced-item references too.
        await tx.execute(sql`DELETE FROM crm.synced_items WHERE linked_account_id = ${p.id} AND tenant_id = ${p.tenantId}`);
        await tx.execute(sql`DELETE FROM crm.linked_accounts WHERE id = ${p.id} AND tenant_id = ${p.tenantId}`);
        await enqueue(tx, {
          topic: EVENTS.linkedAccountDisconnected, eventType: EVENTS.linkedAccountDisconnected,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { linkedAccountId: p.id },
        });
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "crm", action: "linked_account_disconnect", resourceType: "linked_account", resourceId: p.id, outcome: "success" },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "disconnectLinkedAccount failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.linkSyncedItem, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; linkedAccountId: string; kind: string;
      externalId: string; subjectType: string; subjectId: string; occurredAt: string;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          INSERT INTO crm.synced_items
            (id, tenant_id, linked_account_id, kind, external_id, subject_type, subject_id, occurred_at, created_by)
          VALUES (${p.id}, ${p.tenantId}, ${p.linkedAccountId}, ${p.kind}, ${p.externalId},
                  ${p.subjectType}, ${p.subjectId}, ${p.occurredAt}, ${msg.actorId})
          ON CONFLICT (tenant_id, linked_account_id, external_id) DO NOTHING
        `);
        await enqueue(tx, {
          topic: EVENTS.syncedItemLinked, eventType: EVENTS.syncedItemLinked,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { syncedItemId: p.id, subjectType: p.subjectType, subjectId: p.subjectId, kind: p.kind },
        });
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "crm", action: "synced_item_link", resourceType: "synced_item", resourceId: p.id, outcome: "success" },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "linkSyncedItem failed");
      throw err;
    }
  });
}
