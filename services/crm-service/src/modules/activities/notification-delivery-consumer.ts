/**
 * notification-service publishes `notification.delivery.to_crm` (CH-06,
 * services/notification-service/src/modules/channels/crm-timeline-routes.ts)
 * with NOTHING in crm-service consuming it: the POST to
 * /v1/notification/channels/crm-timeline always returned 202, but the
 * delivery event never reached a contact's activity timeline. This file
 * closes that orphan loop.
 *
 * Kept in its own file / own registration line (see consumers.ts) rather than
 * folded into modules/activities/consumer.ts, per the collision note: this
 * service is being actively worked by other sessions and modules/activities
 * is a hot file there.
 *
 * Idempotent on the notification's own id: it is reused verbatim as both the
 * outbox messageId (markProcessed) and the inserted activity row's primary
 * key, so `activities.insert` failing on a redelivered id would also be a
 * harmless primary-key backstop even if markProcessed were ever bypassed.
 *
 * Tenant/RLS: runs inside `db.transaction`, the same pattern
 * modules/activities/consumer.ts uses with no extra tenant-scoping wrapper —
 * this service's createTenantDb() sets the `app.tenant_id` GUC from the
 * message's AsyncLocalStorage context automatically.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import * as repo from "./repo.js";
import * as contactRepo from "../contacts/repo.js";

/** Must match COMMANDS.deliveryToCrm in notification-service/src/topics.ts. */
const DELIVERY_TO_CRM_TOPIC = "notification.delivery.to_crm";
const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "activity";
/** activities.type is varchar(16); "communication_delivery" (22 chars) does not fit. */
const ACTIVITY_TYPE = "comm_delivery";

type DeliveryToCrmPayload = {
  id: string;
  tenantId: string;
  status: "delivered" | "opened" | "clicked" | "bounced" | "failed";
  recipient: string;
  contactId?: string;
  campaignId?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
};

export function registerNotificationDeliveryConsumer(queue: Queue): void {
  queue.subscribe<DeliveryToCrmPayload>(DELIVERY_TO_CRM_TOPIC, async (msg: CommandEnvelope<DeliveryToCrmPayload>) => {
    const p = msg.payload;
    if (typeof p.recipient !== "string" || p.recipient.length === 0 || typeof p.status !== "string") {
      return; // malformed payload — nothing to record, not retryable
    }
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // P0-1-style cross-tenant FK guard, mirroring modules/activities/consumer.ts:
      // a contactId from another tenant must not be attached to this tenant's row.
      let contactId: string | null = p.contactId ?? null;
      if (contactId && !(await contactRepo.contactExists(p.tenantId, contactId))) {
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            service: "crm", action: "record_delivery", resourceType: "activity",
            resourceId: p.id, outcome: "rejected_cross_tenant_contact",
          },
        });
        contactId = null; // still record the delivery below, keyed by recipient only
      }

      const occurredAt = p.occurredAt ? new Date(p.occurredAt) : new Date();
      const summary = `Delivery ${p.status}: ${p.recipient}`;
      const details = [
        `status=${p.status}`,
        `recipient=${p.recipient}`,
        p.campaignId ? `campaignId=${p.campaignId}` : null,
        p.metadata ? `metadata=${JSON.stringify(p.metadata)}` : null,
      ].filter(Boolean).join(" ");

      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        actorName: "Notification Service",
        text: details,
        contactId,
        dealId: null,
        type: ACTIVITY_TYPE,
        subject: summary.slice(0, 200),
        status: "completed",
        dueDate: null,
        completedAt: occurredAt,
        createdBy: msg.actorId,
      });
      if (contactId) await contactRepo.touchLastActivity(tx, contactId, p.tenantId);

      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "crm", action: "record_delivery", resourceType: "activity",
          resourceId: p.id, outcome: "success", deliveryStatus: p.status,
        },
      });
    });

    await cache.invalidateResource(msg.tenantId, RESOURCE);
    if (p.contactId) {
      await cache.invalidate(cache.makeKey(msg.tenantId, "contact", p.contactId));
      await cache.invalidateResource(msg.tenantId, "contact");
    }
  });
}
