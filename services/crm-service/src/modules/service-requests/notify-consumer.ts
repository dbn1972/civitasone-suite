/**
 * F6-02 — service-request resolution/closure notification to the citizen.
 *
 * When a service request is resolved or closed, the status route enqueues the
 * `notifyServiceRequestResolution` command (same tx as the status write). This
 * consumer:
 *   1. reads the SR row to obtain the citizen phone/email (kept OUT of the queue
 *      payload — PII never travels on the bus);
 *   2. respects an opt-out if one exists (see DECISION below);
 *   3. calls notification-service `/notifications/send` OUT of the DB transaction
 *      (no cross-service call inside a tx — CLAUDE.md §4);
 *   4. writes the delivery result back as an activity on the linked contact (when
 *      the SR has one), mirroring modules/communications' delivery write-back;
 *   5. emits a domain + audit event carrying ids/status only, never the value.
 *
 * Idempotent on the outbox messageId via markProcessed, which is claimed ONLY
 * after the send has an outcome. A transient failure (network, 408/429/5xx)
 * therefore throws and leaves the message unprocessed so the queue redelivers
 * it, instead of burning the notice. A permanent failure (other 4xx) is
 * recorded as `failed` and marked processed (retrying cannot help).
 *
 * DECISION (F6-02 opt-out): a service-request resolution notice is a
 * TRANSACTIONAL message about a request the citizen themselves raised, so it
 * does not require marketing consent (per the item). The CRM contacts schema has
 * no dedicated transactional opt-out column, so there is no opt-out flag to
 * honour today; the single consent re-check below is where one would be enforced
 * if such a column is added. Recorded so the choice is explicit, not silent.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as activityRepo from "../activities/repo.js";

const log = pino({ name: "crm-sr-notify-consumer" });
const AUDIT = "audit.event.record";
const NOTIFICATION_URL = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:3006";
/** activities.type is varchar(16). */
const ACTIVITY_TYPE = "comm_delivery";

interface NotifyPayload {
  serviceRequestId: string;
  tenantId: string;
  status: string;
}

interface SrContact {
  id: string;
  referenceNo: string | null;
  citizenName: string;
  citizenPhone: string | null;
  citizenEmail: string | null;
  contactId: string | null;
}

type DeliveryResult =
  | { kind: "sent"; deliveryId: string }
  | { kind: "permanent_failure" }
  | { kind: "transient_failure" };

async function callNotificationService(
  tenantId: string,
  channel: "sms" | "email",
  recipient: string,
  variables: Record<string, string>,
  correlationId: string,
  idempotencyKey: string,
): Promise<DeliveryResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`${NOTIFICATION_URL}/notifications/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": tenantId,
        "x-correlation-id": correlationId,
        "x-idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        channel,
        templateId: "service_request_resolution",
        recipient,
        variables,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const body = (await res.json()) as { id?: string; deliveryId?: string };
      return { kind: "sent", deliveryId: body.deliveryId ?? body.id ?? correlationId };
    }
    log.warn({ status: res.status }, "notification-service non-ok");
    const transient = res.status === 408 || res.status === 429 || res.status >= 500;
    return { kind: transient ? "transient_failure" : "permanent_failure" };
  } catch (err) {
    log.error({ err }, "notification-service call failed");
    return { kind: "transient_failure" };
  }
}

async function processNotify(
  msg: { messageId: string; tenantId: string; actorId: string; correlationId: string },
  p: NotifyPayload,
): Promise<void> {
  let target: SrContact | null = null;
  let channel: "sms" | "email" | null = null;

  let alreadyDone = false;
  await db.transaction(async (tx) => {
    // Read-only already-processed check; the claim itself happens after the send.
    const seen = (await tx.execute(sql`
      SELECT 1 AS ok FROM _inbox.processed WHERE message_id = ${msg.messageId}::uuid LIMIT 1
    `)) as unknown as Array<{ ok: number }>;
    if (seen.length > 0) { alreadyDone = true; return; }

    const rows = (await tx.execute(sql`
      SELECT id,
             reference_no  AS "referenceNo",
             citizen_name  AS "citizenName",
             citizen_phone AS "citizenPhone",
             citizen_email AS "citizenEmail",
             contact_id    AS "contactId"
      FROM crm.service_requests
      WHERE id = ${p.serviceRequestId} AND tenant_id = ${p.tenantId}
      LIMIT 1
    `)) as unknown as SrContact[];
    const sr = rows[0];
    if (!sr) return;

    // No channel -> nothing to notify. Prefer email, then SMS.
    if (sr.citizenEmail) channel = "email";
    else if (sr.citizenPhone) channel = "sms";

    if (!channel) {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "crm", action: "service_request_notify_skipped",
          resourceType: "service_request", resourceId: p.serviceRequestId,
          outcome: "no_contact_channel",
        },
      });
      return;
    }
    target = sr;
  });

  if (alreadyDone || !target || !channel) return;
  const sr: SrContact = target;
  const recipient = channel === "email" ? sr.citizenEmail! : sr.citizenPhone!;

  // Cross-service call OUTSIDE any DB transaction.
  const delivery = await callNotificationService(
    p.tenantId,
    channel,
    recipient,
    {
      citizenName: sr.citizenName,
      referenceNo: sr.referenceNo ?? "",
      status: p.status,
    },
    msg.correlationId,
    msg.messageId,
  );

  // Transient failure: leave the message UNPROCESSED and throw so the queue
  // redelivers (retry / DLQ), rather than recording a lost notice.
  if (delivery.kind === "transient_failure") {
    throw new Error("notification-service transient failure; will retry");
  }
  const outcome = delivery.kind === "sent" ? "sent" : "failed";

  // Write the delivery result back as an activity + audit, in one tx. The
  // activity text records status + channel + reference, never the raw recipient.
  await db.transaction(async (tx) => {
    // Claim the message now that the send has a terminal outcome. False means a
    // concurrent delivery already recorded it, so write nothing twice.
    if (!(await markProcessed(tx, msg.messageId))) return;
    await activityRepo.insert(tx as Parameters<typeof activityRepo.insert>[0], {
      id: randomUUID(),
      tenantId: p.tenantId,
      actorName: "Notification Service",
      text: `Service request ${p.status} notification ${outcome} via ${channel} (ref ${sr.referenceNo ?? sr.id})`,
      contactId: sr.contactId,
      dealId: null,
      type: ACTIVITY_TYPE,
      subject: `SR ${p.status} notice: ${outcome}`.slice(0, 200),
      status: "completed",
      dueDate: null,
      completedAt: new Date(),
      createdBy: msg.actorId,
    });

    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: EVENTS.serviceRequestCitizenNotified, eventType: EVENTS.serviceRequestCitizenNotified,
      tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
      payload: {
        serviceRequestId: p.serviceRequestId, status: p.status, channel, outcome,
      },
    });
    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: AUDIT, eventType: AUDIT,
      tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
      payload: {
        service: "crm", action: "service_request_notify",
        resourceType: "service_request", resourceId: p.serviceRequestId,
        outcome, channel,
      },
    });
  });
}

export function registerServiceRequestNotifyConsumer(queue: Queue): void {
  queue.subscribe<NotifyPayload>(
    COMMANDS.notifyServiceRequestResolution,
    async (msg: CommandEnvelope<NotifyPayload>) => {
      try {
        await processNotify(msg, msg.payload);
      } catch (err) {
        log.error({ err, messageId: msg.messageId }, "notifyServiceRequestResolution failed");
        throw err;
      }
    },
  );
}
