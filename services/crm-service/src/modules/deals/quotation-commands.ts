import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { commandId } from "../../shared/idempotency.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function pub(ctx: RequestContext, type: string, id: string, payload: Record<string, unknown>): Promise<Accepted> {
  await queue.publish(type, {
    messageId: commandId(ctx, `${type}:${id}`), type, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...payload, id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export const createQuotation = (ctx: RequestContext, id: string, body: Record<string, unknown>) =>
  pub(ctx, COMMANDS.createQuotation, id, body);

export const versionQuotation = (ctx: RequestContext, id: string, body: Record<string, unknown>) =>
  pub(ctx, COMMANDS.versionQuotation, id, body);

export const sendQuotation = (ctx: RequestContext, id: string, body: Record<string, unknown>) =>
  pub(ctx, COMMANDS.sendQuotation, id, body);

export const acceptQuotation = (ctx: RequestContext, id: string, body: Record<string, unknown>) =>
  pub(ctx, COMMANDS.acceptQuotation, id, body);

export const rejectQuotation = (ctx: RequestContext, id: string, body: Record<string, unknown>) =>
  pub(ctx, COMMANDS.rejectQuotation, id, body);
