import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateTenderBody, SubmitBidBody, TechEvaluateBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createTender(ctx: RequestContext, body: CreateTenderBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.tenderCreate, {
    messageId: id, type: COMMANDS.tenderCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function publishTender(ctx: RequestContext, tenderId: string): Promise<Accepted> {
  await queue.publish(COMMANDS.tenderPublish, {
    messageId: randomUUID(), type: COMMANDS.tenderPublish,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: tenderId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "tender", tenderId));
  return { id: tenderId, status: "accepted", correlationId: ctx.correlationId };
}

export async function submitBid(ctx: RequestContext, tenderId: string, body: SubmitBidBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.tenderBidSubmit, {
    messageId: id, type: COMMANDS.tenderBidSubmit,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenderId, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function technicalEvaluate(ctx: RequestContext, tenderId: string, body: TechEvaluateBody): Promise<Accepted> {
  await queue.publish(COMMANDS.tenderTechEvaluate, {
    messageId: randomUUID(), type: COMMANDS.tenderTechEvaluate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: tenderId, tenantId: ctx.tenantId, results: body.results },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "tender", tenderId));
  return { id: tenderId, status: "accepted", correlationId: ctx.correlationId };
}

/** Open ALL financial envelopes for technically-qualified bids of a tender. */
export async function openFinancials(ctx: RequestContext, tenderId: string): Promise<Accepted> {
  await queue.publish(COMMANDS.tenderFinancialOpen, {
    messageId: randomUUID(), type: COMMANDS.tenderFinancialOpen,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: tenderId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "tender", tenderId));
  return { id: tenderId, status: "accepted", correlationId: ctx.correlationId };
}

/** Determine L1 and award → emit PO creation. */
export async function awardTender(ctx: RequestContext, tenderId: string): Promise<Accepted> {
  await queue.publish(COMMANDS.tenderAward, {
    messageId: randomUUID(), type: COMMANDS.tenderAward,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: tenderId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "tender", tenderId));
  return { id: tenderId, status: "accepted", correlationId: ctx.correlationId };
}
