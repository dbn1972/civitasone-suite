/**
 * Inbound Lead Capture Consumer
 *
 * Subscribes to crm.lead.inbound_capture and creates a contact record
 * with lead_status='new'. Emits crm.lead.captured event + audit trail.
 * Supports LM-005 requirement.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db, sqlClient } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "contact";

interface InboundPayload {
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

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const contactId = randomUUID();
      const attrs = payload.attributes;

      // INSERT into crm.contacts with lead_status='new', source=channel
      await sqlClient`
        INSERT INTO crm.contacts (
          id, tenant_id, name, email, phone, company, designation, city,
          lead_source, lead_status, status, version, created_at, updated_at,
          created_by, updated_by
        ) VALUES (
          ${contactId},
          ${msg.tenantId},
          ${attrs.name ?? null},
          ${attrs.email ?? null},
          ${attrs.phone ?? null},
          ${attrs.company ?? null},
          ${attrs.designation ?? null},
          ${attrs.city ?? null},
          ${payload.channel},
          'new',
          'active',
          1,
          now(),
          now(),
          ${msg.actorId},
          ${msg.actorId}
        )
      `;

      // Emit crm.lead.captured event via outbox
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
          attributes: attrs,
          metadata: payload.metadata,
        },
      });

      // Audit trail
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
          outcome: "success",
          metadata: { channel: payload.channel, source: payload.source },
        },
      });
    });

    // Cache invalidation after successful commit
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });
}
