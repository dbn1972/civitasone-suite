/**
 * F6-02 — service-request resolution/closure notification to the citizen.
 *
 * When a service request is resolved or closed, the status route enqueues the
 * `notifyServiceRequestResolution` command (same tx as the status write). This
 * consumer:
 *   1. reads the SR row to obtain the citizen phone/email (kept OUT of the queue
 *      payload — PII never travels on the bus);
 *   2. respects an opt-out if one exists (see DECISION below);
 *   3. finds the tenant's `service_request_resolution` template for the channel
 *      and calls notification-service `/notifications/send` OUT of the DB
 *      transaction (no cross-service call inside a tx — CLAUDE.md §4);
 *   4. records the outcome ON THE REQUEST (citizen_notify_* columns, which the
 *      detail page shows), writes the delivery result back as an activity on the
 *      linked contact (when the SR has one), mirroring modules/communications'
 *      delivery write-back;
 *   5. emits a domain + audit event carrying ids/status only, never the value.
 *
 * GAP-CRM-SERVICE-REQUESTS-DETAIL-04 — the cross-service contract. notification-
 * service authenticates every route and its `templateId` must be a UUID, so the
 * old call (no credential, a template *name* in `templateId`) could never have
 * succeeded. Now:
 *   - the call carries the established service-to-service credential
 *     (`x-internal` + `x-service-secret` + `x-tenant-id`);
 *   - the template is looked up by NAME in the tenant's own templates, and its
 *     UUID is what is sent. A tenant that has not created the template gets the
 *     honest outcome `no_template` (recorded, audited, shown on the request) —
 *     never a fake "sent" and never a silent drop. The wording of a message to
 *     the public is the tenant's to author and approve (and SMS needs DLT
 *     registration), so it is not invented here.
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
/** The tenant template that carries the resolution notice (one per channel). */
export const SR_RESOLUTION_TEMPLATE_NAME = "service_request_resolution";

type Channel = "sms" | "email";
type Outcome = "sent" | "failed" | "no_template";

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

type TemplateLookup =
  | { kind: "found"; templateId: string }
  | { kind: "missing" }
  | { kind: "permanent_failure" }
  | { kind: "transient_failure" };

/** Email first, else SMS — the same rule the status route applies in SQL. */
export function pickNotifyChannel(sr: { citizenEmail: string | null; citizenPhone: string | null }): Channel | null {
  if (sr.citizenEmail) return "email";
  if (sr.citizenPhone) return "sms";
  return null;
}

/** The credential notification-service's auth plugin accepts for a peer service. */
function internalHeaders(tenantId: string, correlationId: string): Record<string, string> {
  return {
    "x-internal": "1",
    "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
    "x-internal-caller": "crm-service",
    "x-tenant-id": tenantId,
    "x-correlation-id": correlationId,
  };
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function findResolutionTemplate(
  tenantId: string,
  channel: Channel,
  correlationId: string,
): Promise<TemplateLookup> {
  try {
    const res = await fetch(`${NOTIFICATION_URL}/notifications/templates`, {
      headers: internalHeaders(tenantId, correlationId),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      log.warn({ status: res.status }, "notification-service template lookup non-ok");
      return { kind: isTransientStatus(res.status) ? "transient_failure" : "permanent_failure" };
    }
    const body = (await res.json()) as unknown;
    const list = Array.isArray(body) ? body : (body as { data?: unknown } | null)?.data;
    const hit = (Array.isArray(list) ? list : []).find(
      (t): t is { id: string } =>
        !!t &&
        typeof t === "object" &&
        (t as { name?: unknown }).name === SR_RESOLUTION_TEMPLATE_NAME &&
        (t as { channel?: unknown }).channel === channel &&
        (t as { status?: unknown }).status === "active" &&
        typeof (t as { id?: unknown }).id === "string",
    );
    return hit ? { kind: "found", templateId: hit.id } : { kind: "missing" };
  } catch (err) {
    log.error({ err }, "notification-service template lookup failed");
    return { kind: "transient_failure" };
  }
}

async function callNotificationService(
  tenantId: string,
  channel: Channel,
  templateId: string,
  recipient: string,
  variables: Record<string, string>,
  correlationId: string,
  idempotencyKey: string,
): Promise<DeliveryResult> {
  try {
    const res = await fetch(`${NOTIFICATION_URL}/notifications/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...internalHeaders(tenantId, correlationId),
        "x-idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({ channel, templateId, recipient, variables }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const body = (await res.json()) as { id?: string; deliveryId?: string };
      return { kind: "sent", deliveryId: body.deliveryId ?? body.id ?? correlationId };
    }
    log.warn({ status: res.status }, "notification-service non-ok");
    return { kind: isTransientStatus(res.status) ? "transient_failure" : "permanent_failure" };
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
  let channel: Channel | null = null;

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

    // No channel -> nothing to notify.
    channel = pickNotifyChannel(sr);

    if (!channel) {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // The status route already marked this no_contact; restate it here so the
      // request is right even if the contact details were removed in between.
      await tx.execute(sql`
        UPDATE crm.service_requests
        SET citizen_notify_channel = NULL, citizen_notify_outcome = 'no_contact', citizen_notified_at = now()
        WHERE id = ${p.serviceRequestId} AND tenant_id = ${p.tenantId}
      `);
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
  const ch: Channel = channel;
  const recipient = ch === "email" ? sr.citizenEmail! : sr.citizenPhone!;

  // Cross-service calls OUTSIDE any DB transaction.
  let outcome: Outcome;
  const template = await findResolutionTemplate(p.tenantId, ch, msg.correlationId);
  if (template.kind === "transient_failure") {
    // Leave the message UNPROCESSED and throw so the queue redelivers (retry /
    // DLQ), rather than recording a lost notice.
    throw new Error("notification-service transient failure; will retry");
  }
  if (template.kind === "missing") {
    outcome = "no_template";
  } else if (template.kind === "permanent_failure") {
    outcome = "failed";
  } else {
    const delivery = await callNotificationService(
      p.tenantId,
      ch,
      template.templateId,
      recipient,
      {
        citizenName: sr.citizenName,
        referenceNo: sr.referenceNo ?? "",
        status: p.status,
      },
      msg.correlationId,
      msg.messageId,
    );
    if (delivery.kind === "transient_failure") {
      throw new Error("notification-service transient failure; will retry");
    }
    outcome = delivery.kind === "sent" ? "sent" : "failed";
  }

  // Write the delivery result back — on the request, as an activity, and as
  // audit — in one tx. The activity text records status + channel + reference,
  // never the raw recipient.
  await db.transaction(async (tx) => {
    // Claim the message now that the send has a terminal outcome. False means a
    // concurrent delivery already recorded it, so write nothing twice.
    if (!(await markProcessed(tx, msg.messageId))) return;

    // GAP-CRM-SERVICE-REQUESTS-DETAIL-04: surface the result on the request. This
    // deliberately does NOT bump version/updated_at: a delivery result must never
    // make an officer's open page look stale and 409 their next action.
    await tx.execute(sql`
      UPDATE crm.service_requests
      SET citizen_notify_channel = ${ch}, citizen_notify_outcome = ${outcome}, citizen_notified_at = now()
      WHERE id = ${p.serviceRequestId} AND tenant_id = ${p.tenantId}
    `);

    const outcomeText =
      outcome === "no_template"
        ? `not sent via ${ch}: no "${SR_RESOLUTION_TEMPLATE_NAME}" template is configured`
        : `${outcome} via ${ch}`;
    await activityRepo.insert(tx as Parameters<typeof activityRepo.insert>[0], {
      id: randomUUID(),
      tenantId: p.tenantId,
      actorName: "Notification Service",
      text: `Service request ${p.status} notification ${outcomeText} (ref ${sr.referenceNo ?? sr.id})`,
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
        serviceRequestId: p.serviceRequestId, status: p.status, channel: ch, outcome,
      },
    });
    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: AUDIT, eventType: AUDIT,
      tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
      payload: {
        service: "crm", action: "service_request_notify",
        resourceType: "service_request", resourceId: p.serviceRequestId,
        outcome, channel: ch,
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
