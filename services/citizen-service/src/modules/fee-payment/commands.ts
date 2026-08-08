import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { assertPaymentConfirmable, isGatewayConfigured, isRefundable } from "./domain.js";
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
  const id = randomUUID();
  const accepted = await publish(ctx, COMMANDS.paymentIntentCreate, id, { id, ...body });
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
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : "CONFIRM_REJECTED";
    if (code === "PAYMENT_NOT_PENDING") {
      throw new HttpError(409, code, "payment is not pending confirmation");
    }
    if (code === "GATEWAY_NOT_CONFIGURED") {
      throw new HttpError(409, code, "payment gateway is not configured; use mode=sandbox for Test runs");
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
  if (body.amount > Number(pay.amount)) throw new HttpError(422, "AMOUNT_TOO_HIGH", "refund exceeds payment amount");
  const existing = await repo.listRefundsByPayment(ctx.tenantId, paymentId);
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
