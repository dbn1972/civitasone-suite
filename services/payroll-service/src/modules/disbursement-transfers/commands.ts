/**
 * Command publishers for the disbursement transfer ledger. Routes validate
 * and pre-check synchronously (so callers get 404/409 immediately), then
 * publish; consumer.ts performs the write + audit in one transaction and
 * re-asserts every precondition under a row lock.
 */
import { createHash } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deterministicUuid } from "../../shared/deterministic-id.js";

export function retryRequestHash(transferId: string, reason: string): string {
  return createHash("sha256").update(JSON.stringify({ transferId, reason })).digest("hex");
}

/**
 * The retry row id is a pure function of (tenant, transfer, idempotency key):
 * the same request always names the same row, and a key reused for a
 * different transfer never names the other request's row.
 */
export function retryTransferId(tenantId: string, transferId: string, idempotencyKey: string): string {
  return deterministicUuid(`payroll-disbursement-transfer-retry:${tenantId}:${transferId}:${idempotencyKey}`);
}

export type RetryPayload = {
  transferId: string;
  retryId: string;
  reason: string;
  idempotencyKey: string;
  requestHash: string;
};

export async function requestTransferRetry(ctx: RequestContext, payload: RetryPayload): Promise<void> {
  await queue.publish(COMMANDS.disbursementTransferRetry, {
    // Same key + same payload -> same messageId -> inbox dedup. Same key with a
    // different payload gets a different messageId, reaches the consumer, and
    // is rejected there (IDEMPOTENCY_KEY_REUSED) because the row id collides.
    messageId: deterministicUuid(
      `payroll-disbursement-transfer-retry-msg:${ctx.tenantId}:${payload.idempotencyKey}:${payload.requestHash}`),
    type: COMMANDS.disbursementTransferRetry,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload,
  });
}

export type ReconcilePayload = {
  transferId: string;
  outcome: "success" | "failed" | "returned";
  reason: string;
  reasonCode: string | null;
};

export async function requestTransferReconcile(ctx: RequestContext, payload: ReconcilePayload): Promise<void> {
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  await queue.publish(COMMANDS.disbursementTransferReconcile, {
    messageId: deterministicUuid(`payroll-disbursement-transfer-reconcile:${ctx.tenantId}:${hash}`),
    type: COMMANDS.disbursementTransferReconcile,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload,
  });
}
