/** Outbox helpers: domain event + audit.event.record, always enqueued inside the writing transaction. */
import { enqueue } from "../../shared/outbox.js";
import type { Writer } from "./repo.js";

export const AUDIT_TOPIC = "audit.event.record";

export interface EventCtx { tenantId: string; actorId: string; correlationId: string }

export async function emitEvent(tx: Writer, c: EventCtx, topic: string, payload: Record<string, unknown>): Promise<void> {
  await enqueue(tx as Parameters<typeof enqueue>[0], { topic, eventType: topic, tenantId: c.tenantId, actorId: c.actorId, correlationId: c.correlationId, payload });
}

export interface AuditInput {
  action: string;
  resourceType: string;
  resourceId: string;
  outcome?: "success" | "denied" | "failure";
  severity?: "info" | "warning" | "critical";
  /** Must NEVER contain raw PII - ids, state names, reason codes and counts only. */
  details?: Record<string, unknown>;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
}

export async function emitAudit(tx: Writer, c: EventCtx, a: AuditInput): Promise<void> {
  await emitEvent(tx, c, AUDIT_TOPIC, {
    service: "document",
    action: a.action,
    resourceType: a.resourceType,
    resourceId: a.resourceId,
    outcome: a.outcome ?? "success",
    ...(a.severity ? { severity: a.severity } : {}),
    ...(a.details ? { details: a.details } : {}),
    ...(a.oldValue ? { oldValue: a.oldValue } : {}),
    ...(a.newValue ? { newValue: a.newValue } : {}),
  });
}
