/**
 * UAT T-PERIOD D-01: the one reopen implementation, shared by the direct reopen consumer (a soft-closed month, or any
 * month when the second-approver setting is off) and the approved period_reopen change request (a hard-closed month,
 * second finance_admin approver -- approvals/consumer.ts). Order matters: the state change FIRST, and only when it
 * actually moved the row the reopen log, finance.period.reopened and the audit event -- all in the caller's single
 * transaction, so a reopen that did not happen can never be recorded as one.
 */
import { enqueue } from "../../shared/outbox.js";
import { DomainError } from "../masters/domain.js";
import * as periodRepo from "./repo.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;
export type ReopenMeta = { tenantId: string; actorId: string; correlationId: string };

export async function applyPeriodReopen(
  tx: Tx, meta: ReopenMeta, p: { period: string; reason: string | null; requestId?: string },
): Promise<{ fromStatus: string } | null> {
  const moved = await periodRepo.reopenPeriodTx(tx, meta.tenantId, p.period);
  if (!moved) return null;
  await periodRepo.logReopen(tx, {
    id: crypto.randomUUID(),
    tenantId: meta.tenantId,
    period: p.period,
    fromStatus: moved.fromStatus,
    toStatus: "open",
    ...(p.reason ? { reason: p.reason } : {}),
    createdBy: meta.actorId,
  });
  await enqueue(tx, {
    topic: "finance.period.reopened", eventType: "finance.period.reopened",
    tenantId: meta.tenantId, actorId: meta.actorId, correlationId: meta.correlationId,
    payload: { period: p.period, fromStatus: moved.fromStatus, reason: p.reason, ...(p.requestId ? { changeRequestId: p.requestId } : {}) },
  });
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: meta.tenantId, actorId: meta.actorId, correlationId: meta.correlationId,
    payload: {
      fromStatus: moved.fromStatus, toStatus: "open", reason: p.reason ?? null, ...(p.requestId ? { changeRequestId: p.requestId } : {}),
      service: "finance", action: "reopen", resourceType: "period", resourceId: p.period, outcome: "success",
    },
  });
  return moved;
}

/** The approved-request form: a period that is no longer closed turns the approval into a recorded rejection. */
export async function applyPeriodReopenRequest(tx: Tx, meta: ReopenMeta, p: { period: string; reason: string; requestId: string }): Promise<void> {
  const moved = await applyPeriodReopen(tx, meta, p);
  if (!moved) throw new DomainError("PERIOD_NOT_CLOSED", `period ${p.period} is not closed any more; nothing to reopen`);
}
