/**
 * shared/audit.ts — audit-service owns audit storage. Consumers enqueue to
 * `audit.event.record` inside the same transaction as the domain write.
 */
import { enqueue } from "./outbox.js";
import type { ScopedTx } from "./db.js";
import { SERVICE } from "../topics.js";

export const AUDIT_TOPIC = "audit.event.record";

export interface AuditCtx {
  tenantId: string;
  actorId: string;
  correlationId: string;
}

export interface AuditPayload {
  action: string;
  resourceType: string;
  resourceId: string;
  details?: Record<string, unknown>;
}

export async function writeAudit(tx: ScopedTx, ctx: AuditCtx, payload: AuditPayload): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload: { service: SERVICE, outcome: "success", ...payload },
  });
}
