import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { COMMANDS } from "../../topics.js";
import { HttpError, assertOwnership } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as applicationRepo from "../application/repo.js";
import { assertPaymentConfirmable, isGatewayConfigured, isRefundable, isSandboxPaymentEnabled, refundableBalance } from "./domain.js";
import type {
  CreateScheduleBody, CreateIntentBody, RecordOfflineBody,
  ConfirmPaymentBody, RefundRequestBody, RefundDecisionBody,
} from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function publish(ctx: RequestContext, type: string, id: string, payload: Record<string, unknown>): Promise<Accepted> {
  await queue.publish(type, {
    messageId: id,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...payload, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createSchedule(ctx: RequestContext, body: CreateScheduleBody): Promise<Accepted> {
  const id = randomUUID();
  return publish(ctx, COMMANDS.feeScheduleCreate, id, { id, ...body });
}

export async function createPaymentIntent(ctx: RequestContext, body: CreateIntentBody): Promise<Accepted> {
  // V4-G-02: the intent is bound to a real application the caller may act on, and the fee is
  // computed from that application server-side. Caller-supplied subject/citizenId are not trusted.
  const app = await applicationRepo.findApplicationById(body.applicationId);
  if (!app || app.tenantId !== ctx.tenantId) throw new HttpError(404, "NOT_FOUND", "application not found");
  assertOwnership(ctx, app.citizenId);
  if (body.serviceId && body.serviceId !== app.serviceId) {
    throw new HttpError(422, "SERVICE_MISMATCH", "service does not match the application");
  }
  if (body.scheduleId) {
    const sched = await db.transaction((tx) => repo.findScheduleByIdTx(tx, body.scheduleId as string, ctx.tenantId));
    if (!sched || sched.serviceId !== app.serviceId) {
      throw new HttpError(422, "SCHEDULE_MISMATCH", "fee schedule does not belong to the application's service");
    }
  }
  const id = randomUUID();
  const accepted = await publish(ctx, COMMANDS.paymentIntentCreate, id, {
    id, applicationId: app.id, serviceId: app.serviceId, citizenId: app.citizenId,
    ...(body.scheduleId ? { scheduleId: body.scheduleId } : {}), subject: {},
  });
  await cache.put(cache.makeKey(ctx.tenantId, "payment", id), { id, status: "pending" });
  return accepted;
}

export async function recordOfflinePayment(ctx: RequestContext, body: RecordOfflineBody): Promise<Accepted> {
  const id = randomUUID();
  return publish(ctx, COMMANDS.paymentOfflineRecord, id, { id, ...body });
}

/**
 * FN-14 — confirm a pending online payment intent.
 * Live gateway requires configured credentials + gatewayRef; sandbox is an
 * explicitly labelled Test capture that still emits receipt → GL.
 */
export async function confirmPayment(
  ctx: RequestContext, paymentId: string, body: ConfirmPaymentBody,
): Promise<Accepted> {
  const pay = await repo.findPaymentById(paymentId, ctx.tenantId);
  if (!pay) throw new HttpError(404, "NOT_FOUND", "payment not found");
  try {
    assertPaymentConfirmable({
      status: pay.status,
      mode: body.mode,
      gatewayRef: body.gatewayRef ?? pay.gatewayRef,
      gatewayConfigured: isGatewayConfigured(),
      sandboxEnabled: isSandboxPaymentEnabled(),
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : "CONFIRM_REJECTED";
    if (code === "SANDBOX_DISABLED") {
      throw new HttpError(403, code, "sandbox payment confirmation is disabled");
    }
    if (code === "PAYMENT_NOT_PENDING") {
      throw new HttpError(409, code, "payment is not pending confirmation");
    }
    if (code === "GATEWAY_NOT_CONFIGURED") {
      throw new HttpError(409, code, "payment gateway is not configured; payment cannot be confirmed online");
    }
    if (code === "GATEWAY_REF_REQUIRED") {
      throw new HttpError(400, code, "gatewayRef is required for live confirmation");
    }
    throw new HttpError(400, code, "payment cannot be confirmed");
  }
  return publish(ctx, COMMANDS.paymentConfirm, randomUUID(), {
    paymentId,
    mode: body.mode,
    gatewayRef: body.gatewayRef ?? pay.gatewayRef ?? null,
  });
}

export async function requestRefund(ctx: RequestContext, paymentId: string, body: RefundRequestBody): Promise<Accepted> {
  const pay = await repo.findPaymentById(paymentId, ctx.tenantId);
  if (!pay) throw new HttpError(404, "NOT_FOUND", "payment not found");
  if (!isRefundable(pay.status)) throw new HttpError(409, "NOT_REFUNDABLE", "payment is not in a refundable state");
  // pay.amount is a bigint({mode:"number"}) column (a JS number, validator-capped at
  // ₹100 Cr in paise, far below 2^53), so it is compared directly with no coercion.
  const existing = await repo.listRefundsByPayment(ctx.tenantId, paymentId);
  // V4-G-09: bounded by what is still refundable after earlier APPROVED (partial) refunds.
  if (body.amount > refundableBalance(pay.amount, existing)) {
    throw new HttpError(422, "AMOUNT_TOO_HIGH", "refund exceeds the refundable balance of the payment");
  }
  if (existing.some((r) => r.status === "requested")) {
    throw new HttpError(409, "REFUND_PENDING", "a refund request is already pending for this payment");
  }
  const id = randomUUID();
  return publish(ctx, COMMANDS.refundRequest, id, { id, paymentId, ...body });
}

export async function decideRefund(ctx: RequestContext, refundId: string, body: RefundDecisionBody): Promise<Accepted> {
  const row = await db.transaction((tx) => repo.findRefundByIdTx(tx, refundId, ctx.tenantId));
  if (!row) throw new HttpError(404, "NOT_FOUND", "refund not found");
  if (row.status !== "requested") throw new HttpError(409, "ALREADY_DECIDED", "refund already decided");
  if (row.requestedBy === ctx.actorId) {
    throw new HttpError(403, "MAKER_CHECKER", "refund approver must differ from the requester");
  }
  return publish(ctx, COMMANDS.refundDecide, randomUUID(), { refundId, ...body });
}
