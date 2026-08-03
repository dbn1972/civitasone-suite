import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function pub(ctx: RequestContext, type: string, id: string, payload: Record<string, unknown>): Promise<Accepted> {
  await queue.publish(type, {
    messageId: randomUUID(), type, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...payload, id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export const addComment = (ctx: RequestContext, body: Record<string, unknown>) =>
  pub(ctx, COMMANDS.addComment, randomUUID(), body);

export const editComment = (ctx: RequestContext, id: string, body: Record<string, unknown>) =>
  pub(ctx, COMMANDS.editComment, id, body);

export const deleteComment = (ctx: RequestContext, id: string) =>
  pub(ctx, COMMANDS.deleteComment, id, {});
