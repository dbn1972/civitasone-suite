import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateAuctionBody, SubmitBidBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createAuction(ctx: RequestContext, body: CreateAuctionBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.auctionCreate, {
    messageId: id, type: COMMANDS.auctionCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function submitBid(ctx: RequestContext, auctionId: string, body: SubmitBidBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.bidSubmit, {
    messageId: id, type: COMMANDS.bidSubmit,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, auctionId, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function closeAuction(ctx: RequestContext, auctionId: string): Promise<Accepted> {
  await queue.publish(COMMANDS.auctionClose, {
    type: COMMANDS.auctionClose,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: auctionId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "auction", auctionId));
  return { id: auctionId, status: "accepted", correlationId: ctx.correlationId };
}
