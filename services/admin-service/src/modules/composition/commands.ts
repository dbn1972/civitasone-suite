/**
 * Composition applier — WRITE PATH (publish side), ST-M01-03.
 *
 * A tenant's subscription plan (its resolved module set + optional org profile)
 * is applied to the tenant's composition entitlements. Rule (CLAUDE.md §6 /
 * KIRO-BUILD-PROMPT §4.1): NO Postgres writes here. Validate → publish command
 * with a deterministic messageId → return 202. The consumer does the durable
 * write + audit inside one transaction.
 *
 * The applier takes a module set + profile code, NOT a cross-service read of
 * tenant-service's `plans` table — admin-service owns composition and must not
 * reach into another service's DB (L2 / no cross-service SQL). The caller
 * (tenant-admin UI, or an integration that already read the plan) supplies the
 * plan's module ids and profile.
 */
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { commandMessageId } from "../../shared/idempotency.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface ApplyPlanInput {
  /** The tenant whose composition is being set. */
  tenantId: string;
  /** User-selected module ids from the plan (core + hard-deps are derived). */
  moduleIds: string[];
  /** Optional org profile to stamp (e.g. "smarttransfer_standalone"). */
  profileCode: string | null;
}

/**
 * Publish the apply-plan command. Deterministic messageId derived from the
 * target tenant + the correlation id, so a retried request collapses to one
 * effect at the consumer (`_inbox.processed`) while distinct applies stay
 * distinct — the standard admin write-path idempotency (idempotency.ts).
 */
export async function applyPlan(ctx: RequestContext, input: ApplyPlanInput): Promise<Accepted> {
  const id = commandMessageId(ctx, `composition:${input.tenantId}`, "apply_plan");
  await queue.publish(COMMANDS.compositionApplyPlan, {
    messageId: id,
    type: COMMANDS.compositionApplyPlan,
    tenantId: input.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      tenantId: input.tenantId,
      moduleIds: input.moduleIds,
      profileCode: input.profileCode,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
