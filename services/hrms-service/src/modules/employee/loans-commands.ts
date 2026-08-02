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

export const createLoan = (ctx: RequestContext, body: Record<string, unknown>) =>
  pub(ctx, COMMANDS.loanCreate, randomUUID(), body);
export const recordEmiPaid = (ctx: RequestContext, id: string) =>
  pub(ctx, COMMANDS.loanEmiPaid, id, {});
export const createAdvance = (ctx: RequestContext, body: Record<string, unknown>) =>
  pub(ctx, COMMANDS.salaryAdvanceCreate, randomUUID(), body);
export const approveAdvance = (ctx: RequestContext, id: string) =>
  pub(ctx, COMMANDS.salaryAdvanceApprove, id, {});
