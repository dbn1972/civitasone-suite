import { randomUUID } from "node:crypto";
import { publishCommand } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";
import type { RequestContext } from "../../shared/context.js";

/**
 * CLOS3-S1-11: the head id is allocated here (not by the DB default) and returned, so a 202
 * caller can address the head -- e.g. PUT its slabs -- without reading it back.
 */
export async function createRateHead(ctx: RequestContext, payload: { code: string; name: string; category: string; unitOfMeasure?: string | undefined }) {
  const id = randomUUID();
  const { messageId } = await publishCommand(COMMANDS.rateHeadCreate, ctx, { ...payload, id });
  return { messageId, id };
}

export function createRateSlab(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.rateSlabCreate, ctx, payload);
}

export function replaceRateSlabs(ctx: RequestContext, rateHeadId: string, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.rateSlabReplace, ctx, { rateHeadId, ...payload });
}

export function createPenaltyRule(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.penaltyRuleCreate, ctx, payload);
}

export function createRebateRule(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.rebateRuleCreate, ctx, payload);
}
