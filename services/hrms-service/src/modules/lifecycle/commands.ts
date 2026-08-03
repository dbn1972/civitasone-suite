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

export const createPromotion = (ctx: RequestContext, body: Record<string, unknown>) =>
  pub(ctx, COMMANDS.lifecyclePromotionCreate, randomUUID(), body);
export const createTransfer = (ctx: RequestContext, body: Record<string, unknown>) =>
  pub(ctx, COMMANDS.lifecycleTransferCreate, randomUUID(), body);
export const issueTransferOrder = (ctx: RequestContext, id: string, body: Record<string, unknown>) =>
  pub(ctx, COMMANDS.lifecycleTransferIssue, id, body);
export const relieveTransfer = (ctx: RequestContext, id: string, body: Record<string, unknown>) =>
  pub(ctx, COMMANDS.lifecycleTransferRelieve, id, body);
export const joinTransfer = (ctx: RequestContext, id: string, body: Record<string, unknown>) =>
  pub(ctx, COMMANDS.lifecycleTransferJoin, id, body);
