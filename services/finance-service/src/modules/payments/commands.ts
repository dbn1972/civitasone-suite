import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { idempotentId } from "@civitasone/auth";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateBillBody, ApproveBillBody, InitiateEftBody, GemInvoiceMatchBody, CreateAdvanceBody, CreateUCBody, AdjustAdvanceBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createBill(ctx: RequestContext, body: CreateBillBody): Promise<Accepted> {
  const id = idempotentId(ctx); // EVT-4: double-submit dedupe
  // M2: grossMinor is now bigint; accumulate deductions as bigint to match.
  const totalDeductions = body.deductions.reduce((s, d) => s + BigInt(d.amountMinor), 0n);
  const netMinor = body.grossMinor - totalDeductions;
  await queue.publish(COMMANDS.billCreate, {
    messageId: id, type: COMMANDS.billCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, netMinor, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function approveBill(ctx: RequestContext, id: string, body: ApproveBillBody): Promise<Accepted> {
  await queue.publish(COMMANDS.billApprove, {
    type: COMMANDS.billApprove,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, notes: body.notes },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "bill", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function initiatePayment(ctx: RequestContext, body: InitiateEftBody): Promise<Accepted> {
  const id = idempotentId(ctx); // EVT-4: double-submit dedupe
  await queue.publish(COMMANDS.paymentInitiate, {
    messageId: id, type: COMMANDS.paymentInitiate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function gemInvoiceMatch(ctx: RequestContext, body: GemInvoiceMatchBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.gemInvoiceMatch, {
    messageId: id, type: COMMANDS.gemInvoiceMatch,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createAdvance(ctx: RequestContext, body: CreateAdvanceBody): Promise<Accepted> {
  const id = idempotentId(ctx); // EVT-4: double-submit dedupe
  await queue.publish(COMMANDS.advanceCreate, {
    messageId: id, type: COMMANDS.advanceCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createUC(ctx: RequestContext, body: CreateUCBody): Promise<Accepted> {
  const id = idempotentId(ctx); // EVT-4: double-submit dedupe
  await queue.publish(COMMANDS.ucCreate, {
    messageId: id, type: COMMANDS.ucCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function adjustAdvance(ctx: RequestContext, id: string, body: AdjustAdvanceBody): Promise<Accepted> {
  await queue.publish(COMMANDS.advanceAdjust, {
    type: COMMANDS.advanceAdjust,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "advance", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * H1 (payment) — mark a payment as submitted to eOffice for administrative
 * approval. The eFile is raised via the eOffice integration; once approved the
 * `finance.payment.file_decided` callback (see eoffice-consumer) moves the
 * payment to `released`. This transition makes the source state honest while
 * the file is under approval.
 */
export async function submitPaymentForApproval(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.paymentSubmitApproval, {
    type: COMMANDS.paymentSubmitApproval,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "payment", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
