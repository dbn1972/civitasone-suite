/**
 * Read-only pre-check run by commands.computeBonus before it publishes
 * (the route handler stays CQRS-only -- parse, command). Returns the rule so
 * the command can carry the wage ceiling to the consumer.
 */
import type { RequestContext } from "@civitasone/types";
import { scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { bonusRuleViolation, loadBonusRule, type BonusRule } from "./rules.js";

export async function assertBonusWithinRule(
  ctx: RequestContext, body: { basicMinor: number; bonusPct: number },
): Promise<BonusRule> {
  const rule = await scopedRead((tx) => loadBonusRule(tx, ctx.tenantId, new Date().toISOString().slice(0, 10)));
  const violation = bonusRuleViolation(rule, BigInt(body.basicMinor), Math.round(body.bonusPct * 100));
  if (violation) throw new HttpError(400, "BONUS_RULE_VIOLATION", violation);
  return rule;
}
