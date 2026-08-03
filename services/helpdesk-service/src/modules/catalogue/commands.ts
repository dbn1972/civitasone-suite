import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export type RaiseAccepted = Accepted & {
  ticketId: string;
  projectedStatus: string;
  currentStage: string | null;
};

function publish(ctx: RequestContext, type: string, messageId: string, payload: Record<string, unknown>): Promise<string> {
  return queue.publish(type, {
    messageId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, ...payload },
  });
}

export async function createOffering(
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<Accepted> {
  const id = randomUUID();
  await publish(ctx, COMMANDS.catalogueOfferingCreate, id, { id, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateOffering(
  ctx: RequestContext,
  id: string,
  body: Record<string, unknown>,
): Promise<Accepted> {
  await publish(ctx, COMMANDS.catalogueOfferingUpdate, randomUUID(), { id, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createOla(
  ctx: RequestContext,
  offeringId: string,
  body: Record<string, unknown>,
): Promise<Accepted> {
  const id = randomUUID();
  await publish(ctx, COMMANDS.catalogueOlaCreate, id, { id, offeringId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function raiseRequest(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<RaiseAccepted> {
  const requestId = randomUUID();
  const ticketId = randomUUID();
  await publish(ctx, COMMANDS.catalogueRequestRaise, requestId, { requestId, ticketId, ...payload });
  const projectedStatus = payload.initialStatus as string;
  const currentStage = (payload.initialStage as string | null) ?? null;
  return {
    id: requestId,
    ticketId,
    projectedStatus,
    currentStage,
    status: "accepted",
    correlationId: ctx.correlationId,
  };
}

export async function decideApproval(
  ctx: RequestContext,
  requestId: string,
  payload: Record<string, unknown>,
): Promise<Accepted> {
  await publish(ctx, COMMANDS.catalogueRequestApprove, randomUUID(), { requestId, ...payload });
  return { id: requestId, status: "accepted", correlationId: ctx.correlationId };
}

export async function advanceStage(
  ctx: RequestContext,
  requestId: string,
  payload: Record<string, unknown>,
): Promise<Accepted> {
  await publish(ctx, COMMANDS.catalogueRequestAdvance, randomUUID(), { requestId, ...payload });
  return { id: requestId, status: "accepted", correlationId: ctx.correlationId };
}

export async function fulfilRequest(
  ctx: RequestContext,
  requestId: string,
  payload: Record<string, unknown>,
): Promise<Accepted> {
  await publish(ctx, COMMANDS.catalogueRequestFulfil, randomUUID(), { requestId, ...payload });
  return { id: requestId, status: "accepted", correlationId: ctx.correlationId };
}
