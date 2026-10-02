/**
 * Disbursement transfer retry / manual-reconcile consumers. (Bank-file
 * ledger rows are written synchronously with the issuance -- see
 * bank-transfer/issuance.ts.) Each handler runs in ONE
 * transaction: inbox dedup (markProcessed) -> ledger write -> audit outbox
 * row, so a ledger change and its audit event commit or roll back together.
 * Preconditions the route already checked are re-asserted here under a row
 * lock (FOR UPDATE / conditional UPDATE): the route's check is for a fast,
 * precise 404/409; this is the one that makes double-submits safe. A command
 * that loses a race is recorded as an audit event with outcome "failure"
 * and changes nothing.
 */
import type { Queue } from "@civitasone/queue";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed, type DrizzleTx } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { disbursementTransfers } from "./schema.js";
import type { ReconcilePayload, RetryPayload } from "./commands.js";

const AUDIT_TOPIC = "audit.event.record";

type Msg = { messageId: string; tenantId: string; actorId: string; correlationId: string; payload: unknown };

async function audit(
  tx: DrizzleTx,
  msg: Msg,
  action: string,
  resourceType: string,
  resourceId: string,
  outcome: "success" | "failure",
  detail: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "payroll", action, resourceType, resourceId, outcome, detail },
  });
}

export async function handleRetry(msg: Msg): Promise<void> {
  const p = msg.payload as RetryPayload;
  const t = disbursementTransfers;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const reject = (code: string, extra: Record<string, unknown> = {}) =>
      audit(tx, msg, "disbursement_transfer_retry_requested", "disbursement_transfer", p.transferId, "failure", {
        code, retryId: p.retryId, idempotencyKey: p.idempotencyKey, reason: p.reason, ...extra,
      });

    // Row lock on the attempt being retried: concurrent retries serialise here.
    const parent = (await tx.select().from(t)
      .where(and(eq(t.id, p.transferId), eq(t.tenantId, msg.tenantId))).for("update"))[0];
    if (!parent) return reject("NOT_FOUND");

    const prior = (await tx.select().from(t)
      .where(and(eq(t.tenantId, msg.tenantId), eq(t.idempotencyKey, p.idempotencyKey))).limit(1))[0];
    if (prior) {
      if (prior.parentTransferId === parent.id && prior.requestHash === p.requestHash) return; // already applied
      return reject("IDEMPOTENCY_KEY_REUSED");
    }
    if (parent.status !== "failed" && parent.status !== "returned") return reject("INVALID_STATE", { status: parent.status });
    const child = (await tx.select({ id: t.id }).from(t)
      .where(and(eq(t.tenantId, msg.tenantId), eq(t.parentTransferId, parent.id))).limit(1))[0];
    if (child) return reject("ALREADY_RETRIED", { existingRetryId: child.id });
    const runStatus = (Array.from(await tx.execute(sql`
      SELECT status FROM payroll.payroll_runs WHERE id = ${parent.runId}::uuid AND tenant_id = ${msg.tenantId}::uuid
    `) as unknown as Iterable<{ status: string }>))[0]?.status;
    if (runStatus !== "approved" && runStatus !== "disbursed") return reject("RUN_NOT_PAYABLE", { runStatus });

    const row = (await tx.insert(t).values({
      id: p.retryId,
      tenantId: msg.tenantId,
      runId: parent.runId,
      slipId: parent.slipId,
      employeeId: parent.employeeId,
      employeeNo: parent.employeeNo,
      beneficiaryName: parent.beneficiaryName,
      amountMinor: parent.amountMinor,
      ifsc: parent.ifsc,
      accountLast4: parent.accountLast4,
      status: "pending",
      attemptNo: parent.attemptNo + 1,
      parentTransferId: parent.id,
      idempotencyKey: p.idempotencyKey,
      requestHash: p.requestHash,
      requestReason: p.reason,
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    }).returning())[0]!;

    await audit(tx, msg, "disbursement_transfer_retry_requested", "disbursement_transfer", row.id, "success", {
      parentTransferId: parent.id,
      parentStatus: parent.status,
      parentReasonCode: parent.reasonCode,
      runId: parent.runId,
      employeeId: parent.employeeId,
      attemptNo: row.attemptNo,
      amountMinor: row.amountMinor.toString(),
      reason: p.reason,
      idempotencyKey: p.idempotencyKey,
      // Safe default (HUMAN REVIEW): no second approver for a retry -- it only
      // queues the same amount to the same payee for the next bank file.
      makerChecker: false,
    });
  });
}

export async function handleReconcile(msg: Msg): Promise<void> {
  const p = msg.payload as ReconcilePayload;
  const t = disbursementTransfers;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    // Status predicate: only a still-'sent', non-NACH row moves.
    const after = (await tx.update(t).set({
      status: p.outcome,
      reasonCode: p.outcome === "success" ? null : p.reasonCode,
      reasonText: p.outcome === "success" ? null : p.reason,
      settledAt: new Date(),
      updatedAt: new Date(),
      updatedBy: msg.actorId,
    }).where(and(
      eq(t.id, p.transferId), eq(t.tenantId, msg.tenantId), eq(t.status, "sent"),
      sql`${t.fileFormat} IS DISTINCT FROM 'nach'`,
    )).returning())[0];

    if (!after) {
      await audit(tx, msg, "disbursement_transfer_reconciled", "disbursement_transfer", p.transferId, "failure", {
        code: "INVALID_STATE", toStatus: p.outcome, reason: p.reason, manual: true,
      });
      return;
    }
    await audit(tx, msg, "disbursement_transfer_reconciled", "disbursement_transfer", after.id, "success", {
      runId: after.runId,
      employeeId: after.employeeId,
      fileFormat: after.fileFormat,
      fileReference: after.fileReference,
      fromStatus: "sent",
      toStatus: after.status,
      reasonCode: after.reasonCode,
      amountMinor: after.amountMinor.toString(),
      reason: p.reason,
      manual: true,
    });
  });
}

export function registerDisbursementTransferConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.disbursementTransferRetry, (msg) => handleRetry(msg as Msg));
  queue.subscribe(COMMANDS.disbursementTransferReconcile, (msg) => handleReconcile(msg as Msg));
}
