/**
 * Lead Lifecycle Transition Consumer
 *
 * Subscribes to crm.lead.transition and applies the status change,
 * writing an audit trail record to crm.lead_transitions.
 * Emits crm.lead.transitioned event. Supports LQ-004 requirement.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "contact";

interface TransitionPayload {
  contactId: string;
  fromStatus: string;
  targetStatus: string;
  reason: string;
  notes: string | null;
}

export function registerLifecycleConsumer(queue: Queue): void {
  queue.subscribe(COMMANDS.leadTransition, async (msg: CommandEnvelope) => {
    const payload = msg.payload as TransitionPayload;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Both writes go through `tx`, not the raw pooled client: crm.contacts and
      // crm.lead_transitions are FORCE RLS, and only the transaction handle
      // carries the app.tenant_id GUC the policies check.
      await tx.execute(sql`
        UPDATE crm.contacts
        SET lead_status = ${payload.targetStatus},
            updated_at = now(),
            updated_by = ${msg.actorId},
            version = version + 1
        WHERE id = ${payload.contactId}
          AND tenant_id = ${msg.tenantId}
          AND status = 'active'
      `);

      await tx.execute(sql`
        INSERT INTO crm.lead_transitions (
          id, tenant_id, contact_id, from_status, to_status,
          reason, notes, created_at, created_by, version
        ) VALUES (
          gen_random_uuid(),
          ${msg.tenantId},
          ${payload.contactId},
          ${payload.fromStatus},
          ${payload.targetStatus},
          ${payload.reason},
          ${payload.notes},
          now(),
          ${msg.actorId},
          1
        )
      `);

      // Emit crm.lead.transitioned event via outbox
      await enqueue(tx, {
        topic: EVENTS.leadTransitioned,
        eventType: EVENTS.leadTransitioned,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          contactId: payload.contactId,
          fromStatus: payload.fromStatus,
          toStatus: payload.targetStatus,
          reason: payload.reason,
          notes: payload.notes,
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
          action: "lead_status_transitioned",
          resourceType: RESOURCE,
          resourceId: payload.contactId,
          outcome: "success",
          metadata: {
            fromStatus: payload.fromStatus,
            toStatus: payload.targetStatus,
            reason: payload.reason,
          },
        },
      });
    });

    // Cache invalidation after successful commit
    await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE, payload.contactId));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });
}
