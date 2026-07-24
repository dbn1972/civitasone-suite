import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { HttpError } from "../../shared/context.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { FeeScheduleRow } from "./schema.js";
import { computeFee, buildReceiptNo, isGatewayConfigured, isRefundable, type FeeComputation } from "./domain.js";
import type { CreateScheduleBody, ComputeFeeBody, CreateIntentBody, RecordOfflineBody, RefundRequestBody, RefundDecisionBody } from "./validators.js";

/** True for a Postgres unique-violation (optionally on a specific constraint). */
function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint_name?: string } | null;
  return !!e && e.code === "23505" && (!constraint || e.constraint_name === constraint);
}

async function audit(tx: Parameters<typeof enqueue>[0], ctx: RequestContext, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: { service: "citizen", action, resourceType, resourceId, outcome: "success" },
  });
}

async function resolveSchedule(tx: repo.Writer, ctx: RequestContext, scheduleId?: string, serviceId?: string): Promise<FeeScheduleRow> {
  let sched = scheduleId ? await repo.findScheduleByIdTx(tx, scheduleId, ctx.tenantId) : null;
  if (!sched && serviceId) sched = await repo.findActiveScheduleForService(tx, ctx.tenantId, serviceId);
  if (!sched) throw new HttpError(404, "NO_FEE_SCHEDULE", "no active fee schedule found");
  return sched;
}

function compute(sched: FeeScheduleRow, subject: Record<string, unknown>): FeeComputation {
  return computeFee(Number(sched.baseAmount), sched.exemptions, subject);
}

export async function createSchedule(ctx: RequestContext, body: CreateScheduleBody): Promise<{ id: string }> {
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await repo.insertSchedule(tx, {
      id, tenantId: ctx.tenantId, serviceId: body.serviceId, name: body.name,
      baseAmount: body.baseAmount.toFixed(2), currency: body.currency, exemptions: body.exemptions,
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await audit(tx, ctx, "fee_schedule_create", "fee_schedule", id);
  });
  return { id };
}

/** Pure compute — no persistence. Returns the fee an application would owe. */
export async function computeApplicationFee(ctx: RequestContext, body: ComputeFeeBody): Promise<FeeComputation & { currency: string }> {
  return db.transaction(async (tx) => {
    const sched = await resolveSchedule(tx, ctx, body.scheduleId, body.serviceId);
    return { ...compute(sched, body.subject), currency: sched.currency };
  });
}

/**
 * SVC-085 online path. Honest gateway gating: with NO gateway creds the payment
 * is persisted `pending` and clearly labelled `gatewayConfigured:false` — it is
 * NOT marked paid. A receipt is only issued after real settlement (never here).
 */
export async function createPaymentIntent(ctx: RequestContext, body: CreateIntentBody): Promise<{
  id: string; status: string; amount: number; currency: string; gatewayConfigured: boolean; message: string;
}> {
  const id = randomUUID();
  const configured = isGatewayConfigured();
  return db.transaction(async (tx) => {
    const sched = await resolveSchedule(tx, ctx, body.scheduleId, body.serviceId);
    const fee = compute(sched, body.subject);
    // gatewayRef is a provisional handle only; settlement is confirmed out-of-band.
    const gatewayRef = configured ? `pi_${id}` : null;
    await repo.insertPayment(tx, {
      id, tenantId: ctx.tenantId, applicationId: body.applicationId, scheduleId: sched.id,
      citizenId: body.citizenId ?? null, amount: fee.amount.toFixed(2), currency: sched.currency,
      exemptionApplied: fee.exemptionApplied, method: "online", status: "pending",
      gatewayRef, createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await enqueue(tx, {
      topic: COMMANDS.paymentRequested, eventType: COMMANDS.paymentRequested,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: { id, applicationId: body.applicationId, amount: fee.amount, currency: sched.currency, gatewayConfigured: configured },
    });
    await audit(tx, ctx, "payment_intent_create", "payment", id);
    return {
      id, status: "pending", amount: fee.amount, currency: sched.currency, gatewayConfigured: configured,
      message: configured
        ? "Payment intent created; awaiting gateway settlement callback."
        : "No payment gateway configured — payment is PENDING (not collected). Configure PAYMENT_GATEWAY_KEY to enable online capture.",
    };
  });
}

/** Offline collection recorded by an officer → paid immediately + receipt issued. */
export async function recordOfflinePayment(ctx: RequestContext, body: RecordOfflineBody): Promise<{
  id: string; status: string; amount: number; currency: string; receiptNo: string;
}> {
  const id = randomUUID();
  return db.transaction(async (tx) => {
    const sched = await resolveSchedule(tx, ctx, body.scheduleId, body.serviceId);
    const fee = compute(sched, body.subject);
    const now = new Date();
    const year = now.getUTCFullYear();
    // Atomic per-(tenant, year) sequence — no duplicate receipt nos under concurrency.
    const seq = await repo.nextReceiptSeq(tx, ctx.tenantId, year);
    const receiptNo = buildReceiptNo(year, seq);
    try {
      await repo.insertPayment(tx, {
        id, tenantId: ctx.tenantId, applicationId: body.applicationId, scheduleId: sched.id,
        citizenId: body.citizenId ?? null, amount: fee.amount.toFixed(2), currency: sched.currency,
        exemptionApplied: fee.exemptionApplied, method: "offline", status: "offline_recorded",
        gatewayRef: body.reference ?? null, receiptNo, receiptIssuedAt: now,
        reconciliationStatus: "reconciled", createdBy: ctx.actorId, updatedBy: ctx.actorId,
      });
    } catch (err) {
      // Defensive: a receipt-no collision is a retryable conflict, not a raw 500.
      if (isUniqueViolation(err, "uq_payments_receipt_no")) {
        throw new HttpError(409, "RECEIPT_CONFLICT", "receipt number already allocated; please retry");
      }
      throw err;
    }
    await enqueue(tx, {
      topic: EVENTS.receiptIssued, eventType: EVENTS.receiptIssued,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: { id, applicationId: body.applicationId, receiptNo, amount: fee.amount, currency: sched.currency },
    });
    await audit(tx, ctx, "payment_offline_record", "payment", id);
    return { id, status: "offline_recorded", amount: fee.amount, currency: sched.currency, receiptNo };
  });
}

/** Maker step — request a refund on a collected payment. */
export async function requestRefund(ctx: RequestContext, paymentId: string, body: RefundRequestBody): Promise<{ id: string; status: string }> {
  const id = randomUUID();
  return db.transaction(async (tx) => {
    const pay = await repo.findPaymentByIdTx(tx, paymentId, ctx.tenantId);
    if (!pay) throw new HttpError(404, "NOT_FOUND", "payment not found");
    if (!isRefundable(pay.status)) throw new HttpError(409, "NOT_REFUNDABLE", "payment is not in a refundable state");
    if (body.amount > Number(pay.amount)) throw new HttpError(422, "AMOUNT_TOO_HIGH", "refund exceeds payment amount");
    const existing = await repo.listRefundsByPayment(ctx.tenantId, paymentId);
    if (existing.some((r) => r.status === "requested")) {
      throw new HttpError(409, "REFUND_PENDING", "a refund request is already pending for this payment");
    }
    await repo.insertRefund(tx, {
      id, tenantId: ctx.tenantId, paymentId, amount: body.amount.toFixed(2), reason: body.reason ?? null,
      status: "requested", requestedBy: ctx.actorId, createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    // Payment status is left unchanged until a checker approves (so a rejection
    // needs no state restoration).
    await audit(tx, ctx, "refund_request", "refund", id);
    return { id, status: "requested" };
  });
}

/**
 * Checker step — approve/reject a refund (maker-checker: approver MUST differ
 * from the requester).
 */
export async function decideRefund(ctx: RequestContext, refundId: string, body: RefundDecisionBody): Promise<{ id: string; status: string }> {
  return db.transaction(async (tx) => {
    const refund = await repo.findRefundByIdTx(tx, refundId, ctx.tenantId);
    if (!refund) throw new HttpError(404, "NOT_FOUND", "refund not found");
    if (refund.status !== "requested") throw new HttpError(409, "ALREADY_DECIDED", "refund already decided");
    // Maker-checker: the approver must not be the requester.
    if (refund.requestedBy === ctx.actorId) {
      throw new HttpError(403, "MAKER_CHECKER", "refund approver must differ from the requester");
    }
    const approved = body.decision === "approve";
    await repo.updateRefund(tx, refundId, ctx.tenantId, {
      status: approved ? "approved" : "rejected", approvedBy: ctx.actorId, decidedAt: new Date(), updatedBy: ctx.actorId,
    });
    // Only an approval mutates the payment; a rejection leaves it untouched.
    if (approved) {
      await repo.updatePayment(tx, refund.paymentId, ctx.tenantId, { status: "refunded", updatedBy: ctx.actorId });
    }
    await audit(tx, ctx, approved ? "refund_approve" : "refund_reject", "refund", refundId);
    return { id: refundId, status: approved ? "approved" : "rejected" };
  });
}
