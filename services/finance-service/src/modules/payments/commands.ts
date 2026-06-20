import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateBillBody, ApproveBillBody, InitiateEftBody, GemInvoiceMatchBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createBill(ctx: RequestContext, body: CreateBillBody): Promise<Accepted> {
  const id = randomUUID();
  const totalDeductions = body.deductions.reduce((s, d) => s + d.amountMinor, 0);
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
  const id = randomUUID();
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
