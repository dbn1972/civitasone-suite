/**
 * shared/audit.ts — journey-service has no local audit table; audit-service
 * owns audit storage. Every consumer writes its audit trail entry by
 * enqueueing to the shared `audit.event.record` topic from inside the same
 * transaction as the domain write (transactional outbox guarantees delivery).
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
  /**
   * Defaults to "success". A mutation that completed but did NOT do its work —
   * a step whose dispatch failed terminally, for instance — must record
   * "failure", otherwise the audit trail claims an action succeeded when it did
   * not.
   */
  outcome?: "success" | "failure";
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
