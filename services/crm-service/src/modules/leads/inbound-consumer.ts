/**
 * Inbound Lead Capture Consumer
 *
 * Subscribes to crm.lead.inbound_capture and creates a contact record
 * with lead_status='new'. Emits crm.lead.captured event + audit trail.
 * Supports LM-005 requirement.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as contactRepo from "../contacts/repo.js";
import { autoAssign } from "../assignment/consumer.js";

const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "contact";

interface InboundPayload {
  /** Pre-allocated by the route so a redelivery cannot create a second contact. */
  contactId?: string;
  channel: string;
  source: string;
  attributes: {
    name?: string;
    email?: string;
    phone?: string;
    company?: string;
    designation?: string;
    city?: string;
    leadSource?: string;
    [key: string]: unknown;
  };
  metadata: Record<string, unknown>;
}

export function registerInboundCaptureConsumer(queue: Queue): void {
  queue.subscribe(COMMANDS.inboundCapture, async (msg: CommandEnvelope) => {
    const payload = msg.payload as InboundPayload;
    const contactId = payload.contactId ?? randomUUID();

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const attrs = payload.attributes;
      // Written through the contacts repo (not raw SQL) so email/phone land as
      // AES-GCM ciphertext and the email blind index is populated — an inbound
      // lead must be de-duplicable and readable like any other contact.
      // onConflict on (tenant_id, email_idx) means a channel re-sending a known
      // address is recorded as a skip instead of failing the whole delivery.
      const outcome = await contactRepo.bulkInsertRow(tx, {
        id: contactId,
        tenantId: msg.tenantId,
        name: attrs.name ?? "Unknown",
        ...(attrs.email !== undefined ? { email: attrs.email } : {}),
        ...(attrs.phone !== undefined ? { phone: attrs.phone } : {}),
        ...(attrs.company !== undefined ? { company: attrs.company } : {}),
        ...(attrs.designation !== undefined ? { designation: attrs.designation } : {}),
        ...(attrs.city !== undefined ? { city: attrs.city } : {}),
        leadSource: attrs.leadSource ?? payload.channel,
        leadStatus: "new",
        status: "active",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });

      if (outcome === "inserted") {
        // Emit crm.lead.captured via outbox. Attributes are omitted — the payload
        // would otherwise carry contact PII into every downstream topic.
        await enqueue(tx, {
          topic: EVENTS.leadCaptured,
          eventType: EVENTS.leadCaptured,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            contactId,
            channel: payload.channel,
            source: payload.source,
            metadata: payload.metadata,
          },
        });

        // AS-001: route the freshly captured lead through the tenant assignment
        // rules (sets owner_id + assigned_at and writes crm.lead_assignment_log).
        await autoAssign(tx, { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId }, contactId, "auto");
      }

      // Audit trail — a skipped duplicate is still an audited capture attempt.
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "crm",
          action: "inbound_lead_captured",
          resourceType: RESOURCE,
          resourceId: contactId,
          outcome: outcome === "inserted" ? "success" : "duplicate_email_skipped",
          metadata: { channel: payload.channel, source: payload.source },
        },
      });
    });

    // Cache invalidation after successful commit
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });
}
