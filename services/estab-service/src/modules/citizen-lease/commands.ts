import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function publish(type: string, ctx: RequestContext, id: string, payload: Record<string, unknown>): Promise<void> {
  await queue.publish(type, {
    messageId: id, type,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload,
  });
}

export async function createProperty(ctx: RequestContext, body: Record<string, unknown>): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.leasePropertyCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createLease(ctx: RequestContext, body: Record<string, unknown>): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.leaseCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function recordLeasePayment(ctx: RequestContext, leaseId: string, body: Record<string, unknown>): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.leasePaymentRecord, ctx, id, { id, leaseId, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function submitLeaseRequest(ctx: RequestContext, body: Record<string, unknown>): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.leaseRequestSubmit, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function reviewLeaseRequest(ctx: RequestContext, requestId: string, body: Record<string, unknown>): Promise<Accepted> {
  await publish(COMMANDS.leaseRequestReview, ctx, requestId, { id: requestId, tenantId: ctx.tenantId, ...body });
  return { id: requestId, status: "accepted", correlationId: ctx.correlationId };
}

export async function completeLeaseRequest(ctx: RequestContext, requestId: string): Promise<Accepted> {
  await publish(COMMANDS.leaseRequestComplete, ctx, requestId, { id: requestId, tenantId: ctx.tenantId });
  return { id: requestId, status: "accepted", correlationId: ctx.correlationId };
}
