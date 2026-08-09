import { publishCommand } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";
import type { RequestContext } from "../../shared/context.js";

export function createReceipt(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.receiptCreate, ctx, payload);
}

export function createBatchReceipt(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.batchReceiptCreate, ctx, payload);
}

export function createRefund(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.refundCreate, ctx, payload);
}

export function decideRefund(ctx: RequestContext, refundId: string, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.refundDecide, ctx, { ...payload, refundId });
}

export function createAdjustment(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.adjustmentCreate, ctx, payload);
}
