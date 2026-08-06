/**
 * Onboarding health metric commands (G19).
 *
 * CQRS command publishers: route validates → publishes command → 202.
 * Consumer picks up, writes, emits events.
 */
import type { RequestContext } from "@civitasone/types";
import { publishCrmCommand, type Accepted } from "../../shared/residual-publish.js";
import { COMMANDS } from "../../topics.js";
import { invalidateHealthRules, invalidateHealthScore } from "./queries.js";
import type { CreateHealthRuleInput, UpdateHealthRuleInput } from "./validators.js";

export interface CreateHealthRuleCommand extends CreateHealthRuleInput {
  id: string;
}

export interface UpdateHealthRuleCommand {
  changed: Omit<UpdateHealthRuleInput, "version">;
  version: number;
}

export async function createHealthRule(
  ctx: RequestContext,
  id: string,
  cmd: CreateHealthRuleCommand,
): Promise<Accepted> {
  const accepted = await publishCrmCommand(ctx, COMMANDS.createOnboardingHealthRule, id, { ...cmd });
  await invalidateHealthRules(ctx.tenantId);
  return accepted;
}

export async function updateHealthRule(
  ctx: RequestContext,
  id: string,
  cmd: UpdateHealthRuleCommand,
): Promise<Accepted> {
  const accepted = await publishCrmCommand(ctx, COMMANDS.updateOnboardingHealthRule, id, { ...cmd });
  await invalidateHealthRules(ctx.tenantId);
  return accepted;
}

export async function recomputeHealth(
  ctx: RequestContext,
  caseId: string,
): Promise<Accepted> {
  const accepted = await publishCrmCommand(ctx, COMMANDS.recomputeOnboardingHealth, caseId, { caseId });
  await invalidateHealthScore(ctx.tenantId, caseId);
  return accepted;
}
