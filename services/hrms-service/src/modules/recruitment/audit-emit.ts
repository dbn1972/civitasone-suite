/**
 * Recruitment module audit event helper. Emits an audit.event.record to the
 * transactional outbox within the caller's transaction, so it is committed
 * atomically with the write that triggered it. CERT-In compliant: every
 * security/financial mutation is now on the tamper-evident audit trail.
 */
import { enqueue } from "../../shared/outbox.js";

const AUDIT = "audit.event.record";

export interface AuditContext {
  tenantId: string;
  actorId: string;
  correlationId: string;
}

export async function emitAudit(
  tx: unknown,
  ctx: AuditContext,
  action: string,
  resourceType: string,
  resourceId: string,
  details?: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: AUDIT, eventType: AUDIT,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: { service: "hrms", action, resourceType, resourceId, outcome: "success", ...details },
  });
}
