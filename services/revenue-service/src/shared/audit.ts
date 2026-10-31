/**
 * Revenue audit helper (UAT B10-F86).
 *
 * Same pattern as contract-service's `audit(tx, msg, action, resourceType, resourceId)`:
 * the audit event is enqueued on the transactional outbox inside the caller's
 * transaction, and it always names the resource it is about. audit-service
 * stores `payload.resourceId` as the event target, so an event without it
 * cannot be found from the record (which refund or write-off was approved).
 */
import { enqueue } from "./outbox.js";
import { SERVICE } from "../topics.js";

export const AUDIT_TOPIC = "audit.event.record";

type Tx = Parameters<typeof enqueue>[0];
type AuditMsg = { tenantId: string; actorId: string; correlationId: string };

export type RevenueAuditEvent = {
  action: string;
  resourceType: string;
  /** Required: the id of the row the action was taken on. */
  resourceId: string;
  outcome: string;
  [detail: string]: unknown;
};

export async function enqueueAudit(tx: Tx, msg: AuditMsg, event: RevenueAuditEvent): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: SERVICE, ...event },
  });
}
