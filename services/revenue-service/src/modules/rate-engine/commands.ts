import { publishCommand } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";
import type { RequestContext } from "../../shared/context.js";

export function createRateHead(ctx: RequestContext, payload: { code: string; name: string; category: string; unitOfMeasure?: string | undefined }) {
  return publishCommand(COMMANDS.rateHeadCreate, ctx, payload);
}

export function createRateSlab(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.rateSlabCreate, ctx, payload);
}

export function createPenaltyRule(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.penaltyRuleCreate, ctx, payload);
}

export function createRebateRule(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.rebateRuleCreate, ctx, payload);
}
