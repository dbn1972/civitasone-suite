/**
 * Shared outbox helpers for the world-class-gap modules.
 *
 * Both helpers MUST be called inside the same db.transaction() as the data write
 * they describe — that is the whole point of the transactional outbox: either the
 * row and its audit/event land together, or neither does.
 */
import { enqueue } from "./outbox.js";

const AUDIT_TOPIC = "audit.event.record";

export interface OutboxCtx {
  tenantId: string;
  actorId: string;
  correlationId: string;
}

type Tx = Parameters<typeof enqueue>[0];

/** Append an audit-service record for a mutation. */
export async function auditEvent(
  tx: unknown,
  ctx: OutboxCtx,
  action: string,
  resourceType: string,
  resourceId: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx as Tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload: {
      service: "admin",
      action,
      resourceType,
      resourceId,
      outcome: "success",
      ...(extra ?? {}),
    },
  });
}

/** Publish a domain event on the outbox (see src/topics.ts for the contracts). */
export async function domainEvent(
  tx: unknown,
  ctx: OutboxCtx,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx as Tx, {
    topic: eventType,
    eventType,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload,
  });
}
