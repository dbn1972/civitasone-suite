/**
 * CO-001 — consumers for sendCommunication and bulkSendCommunication commands.
 *
 * Before calling notification-service, re-checks consent (it may have changed
 * between route acceptance and consumer execution). If consent was revoked,
 * marks the communication record as status='consent_revoked' and skips delivery.
 *
 * Cross-service call: HTTP POST to notification-service with 10s timeout.
 */
import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const log = pino({ name: "crm-send-consumer" });
const AUDIT = "audit.event.record";
const NOTIFICATION_URL = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:3006";

interface SendPayload {
  id: string;
  tenantId: string;
  recipientContactId: string;
  templateId: string;
  channel: string;
  variables: Record<string, string>;
  scheduledAt: string | null;
}

interface BulkSendPayload {
  id: string;
  tenantId: string;
  contactIds: string[];
  templateId: string;
  channel: string;
  variables: Record<string, string>;
  scheduledAt: string | null;
}

async function callNotificationService(
  tenantId: string,
  channel: string,
  templateId: string,
  contactId: string,
  variables: Record<string, string>,
  correlationId: string,
): Promise<{ deliveryId: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`${NOTIFICATION_URL}/notifications/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": tenantId,
        "x-correlation-id": correlationId,
      },
      body: JSON.stringify({
        channel,
        templateId,
        recipientId: contactId,
        variables,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const body = await res.json() as { id?: string; deliveryId?: string };
      return { deliveryId: body.deliveryId ?? body.id ?? correlationId };
    }
    log.warn({ status: res.status, contactId }, "notification-service returned non-ok");
    return null;
  } catch (err) {
    log.error({ err, contactId }, "notification-service call failed");
    return null;
  }
}

async function processSingleSend(
  msg: { messageId: string; tenantId: string; actorId: string; correlationId: string },
  p: SendPayload,
): Promise<void> {
  let consentOk = false;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    // Re-check consent at consumer time — inside the same tx for consistency
    const rows = await tx.execute(sql`
      SELECT marketing_consent AS "marketingConsent"
      FROM crm.contacts
      WHERE tenant_id = ${p.tenantId} AND id = ${p.recipientContactId} AND status = 'active'
      LIMIT 1
    `) as unknown as Array<{ marketingConsent: boolean }>;

    const contact = rows[0];
    if (!contact || !contact.marketingConsent) {
      // Consent revoked between route and consumer
      await tx.execute(sql`
        INSERT INTO crm.communications
          (id, tenant_id, subject_type, subject_id, direction, channel, status,
           template_id, scheduled_at, logged_by)
        VALUES
          (${p.id}, ${p.tenantId}, 'contact', ${p.recipientContactId}, 'outbound',
           ${p.channel}, 'consent_revoked', ${p.templateId}, ${p.scheduledAt}, ${msg.actorId})
      `);
      log.info({ contactId: p.recipientContactId }, "consent revoked, skipping send");
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "crm", action: "communication_send_consent_revoked",
          resourceType: "communication", resourceId: p.id, outcome: "consent_revoked",
        },
      });
      return;
    }

    consentOk = true;

    // Insert pending comm record
    await tx.execute(sql`
      INSERT INTO crm.communications
        (id, tenant_id, subject_type, subject_id, direction, channel, status,
         template_id, scheduled_at, logged_by)
      VALUES
        (${p.id}, ${p.tenantId}, 'contact', ${p.recipientContactId}, 'outbound',
         ${p.channel}, 'pending', ${p.templateId}, ${p.scheduledAt}, ${msg.actorId})
    `);

    await enqueue(tx, {
      topic: EVENTS.communicationSent, eventType: EVENTS.communicationSent,
      tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
      payload: {
        communicationId: p.id, contactId: p.recipientContactId,
        channel: p.channel, templateId: p.templateId,
      },
    });
    await enqueue(tx, {
      topic: AUDIT, eventType: AUDIT,
      tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
      payload: {
        service: "crm", action: "communication_send",
        resourceType: "communication", resourceId: p.id, outcome: "success",
      },
    });
  });

  if (!consentOk) return;

  // Call notification-service outside the transaction to avoid long locks
  const delivery = await callNotificationService(
    p.tenantId, p.channel, p.templateId,
    p.recipientContactId, p.variables, msg.correlationId,
  );

  if (delivery) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE crm.communications
        SET delivery_id = ${delivery.deliveryId}, status = 'sent'
        WHERE id = ${p.id} AND tenant_id = ${p.tenantId}
      `);
    });
  } else {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE crm.communications
        SET status = 'failed'
        WHERE id = ${p.id} AND tenant_id = ${p.tenantId}
      `);
    });
  }
}

export function registerSendConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.sendCommunication, async (msg) => {
    const p = msg.payload as SendPayload;
    try {
      await processSingleSend(msg, p);
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "sendCommunication failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.bulkSendCommunication, async (msg) => {
    const p = msg.payload as BulkSendPayload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
      });

      // Fan out: process each contact sequentially
      for (const contactId of p.contactIds) {
        const subId = randomUUID();
        const subPayload: SendPayload = {
          id: subId,
          tenantId: p.tenantId,
          recipientContactId: contactId,
          templateId: p.templateId,
          channel: p.channel,
          variables: p.variables,
          scheduledAt: p.scheduledAt,
        };
        await processSingleSend(
          { messageId: randomUUID(), tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId },
          subPayload,
        );
      }
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "bulkSendCommunication failed");
      throw err;
    }
  });
}
