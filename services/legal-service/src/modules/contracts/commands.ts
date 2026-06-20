import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateReviewBody, ClearReviewBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createReview(ctx: RequestContext, body: CreateReviewBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.contractReviewCreate, {
    messageId: id, type: COMMANDS.contractReviewCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function clearReview(ctx: RequestContext, reviewId: string, body: ClearReviewBody): Promise<Accepted> {
  await queue.publish(COMMANDS.contractReviewClear, {
    type: COMMANDS.contractReviewClear,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { reviewId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "contract_review", reviewId));
  return { id: reviewId, status: "accepted", correlationId: ctx.correlationId };
}
