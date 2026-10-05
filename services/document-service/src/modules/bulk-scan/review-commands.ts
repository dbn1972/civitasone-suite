/**
 * Command publishers for review / filing / link actions. Routes call these; NOTHING here writes the DB.
 * The command's messageId is the id returned to the caller (202 + id); consumers apply it with markProcessed.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { Accepted } from "./commands.js";
import type { ApproveBody, EditBody, RejectBody } from "./review-validators.js";

async function publish(ctx: RequestContext, topic: string, payload: Record<string, unknown>, id: string = randomUUID()): Promise<Accepted> {
  await queue.publish(topic, {
    messageId: id, type: topic, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0", payload,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export const editReview = (ctx: RequestContext, fileId: string, body: EditBody): Promise<Accepted> =>
  publish(ctx, COMMANDS.bulkReviewEdit, { fileId, ...body });

/** The returned id doubles as the link id when a link is requested (stable across redelivery). */
export const approveReview = (ctx: RequestContext, fileId: string, body: ApproveBody): Promise<Accepted> => {
  const id = randomUUID();
  return publish(ctx, COMMANDS.bulkReviewApprove, { fileId, linkId: id, ...body }, id);
};

export const rejectReview = (ctx: RequestContext, fileId: string, body: RejectBody): Promise<Accepted> =>
  publish(ctx, COMMANDS.bulkReviewReject, { fileId, ...body });

export const approveLink = (ctx: RequestContext, linkId: string): Promise<Accepted> => publish(ctx, COMMANDS.bulkLinkApprove, { linkId });
export const rejectLink = (ctx: RequestContext, linkId: string, reason: string): Promise<Accepted> => publish(ctx, COMMANDS.bulkLinkReject, { linkId, reason });
export const unlinkLink = (ctx: RequestContext, linkId: string, reason: string): Promise<Accepted> => publish(ctx, COMMANDS.bulkLinkUnlink, { linkId, reason });
