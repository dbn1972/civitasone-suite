/**
 * Contact ownership transfer consumer (AS-002) — applies `crm.contact.transfer`.
 *
 * The route only knows who requested the transfer; the outgoing owner is read
 * inside the transaction so the emitted event records the ownership that was
 * actually replaced rather than the requester.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const log = pino({ name: "crm-transfer-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "contact";

interface TransferPayload {
  contactId: string;
  fromOwnerId: string;
  toOwnerId: string;
  reason: string;
}

export function registerTransferConsumer(queue: Queue): void {
  queue.subscribe(COMMANDS.transferOwnership, async (msg) => {
    const p = msg.payload as TransferPayload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const current = (await tx.execute(sql`
          SELECT owner_id AS "ownerId"
          FROM crm.contacts
          WHERE id = ${p.contactId} AND tenant_id = ${msg.tenantId} AND status = 'active'
          FOR UPDATE
        `)) as unknown as Array<{ ownerId: string | null }>;

        const row = current[0];
        if (!row) {
          await enqueue(tx, {
            topic: AUDIT_TOPIC,
            eventType: AUDIT_TOPIC,
            tenantId: msg.tenantId,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: {
              service: "crm",
              action: "ownership_transferred",
              resourceType: RESOURCE,
              resourceId: p.contactId,
              outcome: "rejected_not_found",
            },
          });
          return;
        }

        await tx.execute(sql`
          UPDATE crm.contacts
          SET owner_id = ${p.toOwnerId},
              updated_at = now(),
              updated_by = ${msg.actorId},
              version = version + 1
          WHERE id = ${p.contactId} AND tenant_id = ${msg.tenantId} AND status = 'active'
        `);

        await enqueue(tx, {
          topic: EVENTS.ownershipTransferred,
          eventType: EVENTS.ownershipTransferred,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            contactId: p.contactId,
            fromOwnerId: row.ownerId,
            toOwnerId: p.toOwnerId,
            requestedBy: p.fromOwnerId,
            reason: p.reason,
          },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "crm",
            action: "ownership_transferred",
            resourceType: RESOURCE,
            resourceId: p.contactId,
            outcome: "success",
            metadata: {
              fromOwnerId: row.ownerId,
              toOwnerId: p.toOwnerId,
              reason: p.reason,
            },
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "transferOwnership failed");
      throw err;
    }

    await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE, p.contactId));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });
}
