/**
 * Simplified module commands — publish to SQS for async processing.
 *
 * Following CQRS: route validates → publishes command → returns 202.
 * The consumer (consumer.ts) handles writes via transactional outbox.
 */
import type { RequestContext } from "@civitasone/types";
import { idempotentId } from "@civitasone/auth";
import { queue } from "../../shared/infra.js";
import { SIMPLIFIED_COMMANDS } from "./topics.js";
import type {
  RecordIncomeBody,
  RecordExpenseBody,
  RecordPaymentReceivedBody,
  RecordPaymentMadeBody,
} from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function recordIncome(ctx: RequestContext, body: RecordIncomeBody): Promise<Accepted> {
  const id = idempotentId(ctx);
  const amountMinor = body.amount;
  const gstMinor = body.amount * BigInt(body.gstRate) / 100n;
  const totalMinor = amountMinor + gstMinor;

  await queue.publish(SIMPLIFIED_COMMANDS.recordIncome, {
    messageId: id,
    type: SIMPLIFIED_COMMANDS.recordIncome,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      amountMinor: amountMinor.toString(),
      gstMinor: gstMinor.toString(),
      totalMinor: totalMinor.toString(),
      customerName: body.customerName,
      description: body.description,
      gstRate: body.gstRate,
      invoiceNo: body.invoiceNo,
      incomeType: body.incomeType,
      postingDate: body.postingDate ?? new Date().toISOString().slice(0, 10),
    },
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function recordExpense(ctx: RequestContext, body: RecordExpenseBody): Promise<Accepted> {
  const id = idempotentId(ctx);
  const amountMinor = body.amount;
  const gstMinor = body.amount * BigInt(body.gstRate) / 100n;
  const totalMinor = amountMinor + gstMinor;

  await queue.publish(SIMPLIFIED_COMMANDS.recordExpense, {
    messageId: id,
    type: SIMPLIFIED_COMMANDS.recordExpense,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      amountMinor: amountMinor.toString(),
      gstMinor: gstMinor.toString(),
      totalMinor: totalMinor.toString(),
      category: body.category,
      vendorName: body.vendorName,
      description: body.description,
      gstRate: body.gstRate,
      postingDate: body.postingDate ?? new Date().toISOString().slice(0, 10),
    },
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function recordPaymentReceived(ctx: RequestContext, body: RecordPaymentReceivedBody): Promise<Accepted> {
  const id = idempotentId(ctx);
  const amountMinor = body.amount;

  await queue.publish(SIMPLIFIED_COMMANDS.recordPaymentReceived, {
    messageId: id,
    type: SIMPLIFIED_COMMANDS.recordPaymentReceived,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      amountMinor: amountMinor.toString(),
      customerName: body.customerName,
      invoiceNo: body.invoiceNo,
      postingDate: body.postingDate ?? new Date().toISOString().slice(0, 10),
    },
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function recordPaymentMade(ctx: RequestContext, body: RecordPaymentMadeBody): Promise<Accepted> {
  const id = idempotentId(ctx);
  const amountMinor = body.amount;

  await queue.publish(SIMPLIFIED_COMMANDS.recordPaymentMade, {
    messageId: id,
    type: SIMPLIFIED_COMMANDS.recordPaymentMade,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      amountMinor: amountMinor.toString(),
      vendorName: body.vendorName,
      description: body.description,
      postingDate: body.postingDate ?? new Date().toISOString().slice(0, 10),
    },
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}
