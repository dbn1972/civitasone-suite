/**
 * Transactional audit/event emission helper for Sprint-2 route handlers.
 *
 * Every mutation must leave an audit trail, and the trail must commit or roll
 * back WITH the business row — hence the outbox insert happens inside the
 * caller's transaction rather than being published directly to the bus.
 *
 * Existing module consumers each hand-rolled this; this helper keeps the newer
 * route files from repeating the cast dance around `enqueue`.
 */
import { enqueue } from "./outbox.js";
import type { RequestContext } from "@civitasone/types";

const AUDIT_TOPIC = "audit.event.record";
const SERVICE_NAME = "crm";

/** Drizzle transaction handle as accepted by the outbox package. */
type OutboxTx = Parameters<typeof enqueue>[0];

export interface AuditableMutation {
  /** Domain event topic/type to publish, e.g. `crm.tender.stage_changed`. */
  eventType: string;
  /** Audit verb, e.g. `create`, `update`, `activate`. */
  action: string;
  /** Audited resource type, e.g. `tender`. */
  resourceType: string;
  resourceId: string;
  /** Domain event payload — must never contain PII. */
  payload: Record<string, unknown>;
  /** Audit outcome; defaults to `success`. */
  outcome?: string;
}

/**
 * Enqueues the domain event + its audit event in the caller's transaction.
 * MUST be called inside `db.transaction(...)` alongside the business write.
 */
export async function emitWithAudit(
  tx: unknown,
  ctx: RequestContext,
  m: AuditableMutation,
): Promise<void> {
  const t = tx as OutboxTx;
  await enqueue(t, {
    topic: m.eventType,
    eventType: m.eventType,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload: m.payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload: {
      service: SERVICE_NAME,
      action: m.action,
      resourceType: m.resourceType,
      resourceId: m.resourceId,
      outcome: m.outcome ?? "success",
    },
  });
}
