/**
 * eligibility/commands.ts — publishes eligibility-rule mutation commands.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CreateRuleInput {
  productId: string;
  ruleType: string;
  criteria: Record<string, unknown>;
}

export async function createEligibilityRule(ctx: RequestContext, body: CreateRuleInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.createEligibilityRule, id, { id, ...body });
}

export async function deleteEligibilityRule(
  ctx: RequestContext,
  id: string,
  body: { productId: string; ruleType: string },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.deleteEligibilityRule, id, { id, ...body });
}
