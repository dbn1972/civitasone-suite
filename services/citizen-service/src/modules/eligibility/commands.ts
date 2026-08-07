import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { assertRulesWellFormed } from "./domain.js";
import type { CreateRuleSetBody, UpdateRuleSetBody, EvaluateBody, ReviewDecisionBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function publish(
  ctx: RequestContext, type: string, messageId: string, payload: Record<string, unknown>,
): Promise<Accepted> {
  await queue.publish(type, {
    messageId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...payload, tenantId: ctx.tenantId },
  });
  return { id: messageId, status: "accepted", correlationId: ctx.correlationId };
}

/** Create a new DRAFT rule set at the next version for the service. */
export async function createRuleSet(ctx: RequestContext, body: CreateRuleSetBody): Promise<Accepted> {
  assertRulesWellFormed(body.rules);
  const id = randomUUID();
  return publish(ctx, COMMANDS.eligibilityRuleSetCreate, id, { id, ...body });
}

/** Update a DRAFT rule set (designer autosave). */
export async function updateRuleSet(ctx: RequestContext, id: string, body: UpdateRuleSetBody): Promise<Accepted> {
  const rs = await repo.findRuleSetById(id, ctx.tenantId);
  if (!rs) throw new HttpError(404, "NOT_FOUND", "rule set not found");
  if (rs.status !== "draft") throw new HttpError(409, "INVALID_STATE", "only a draft can be updated");
  if (body.rules !== undefined) assertRulesWellFormed(body.rules);
  const accepted = await publish(ctx, COMMANDS.eligibilityRuleSetUpdate, randomUUID(), { id, ...body });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "eligibility", id));
  return { ...accepted, id };
}

/** Maker step — record the submitter requesting publication (does NOT publish). */
export async function submitRuleSet(ctx: RequestContext, id: string): Promise<Accepted> {
  const rs = await repo.findRuleSetById(id, ctx.tenantId);
  if (!rs) throw new HttpError(404, "NOT_FOUND", "rule set not found");
  if (rs.status !== "draft") throw new HttpError(409, "INVALID_STATE", "only a draft can be submitted");
  const accepted = await publish(ctx, COMMANDS.eligibilityRuleSetSubmit, randomUUID(), { id });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "eligibility", id));
  return { ...accepted, id };
}

/** Checker step — publish (maker-checker: publisher MUST differ from submitter). */
export async function publishRuleSet(ctx: RequestContext, id: string): Promise<Accepted> {
  const rs = await repo.findRuleSetById(id, ctx.tenantId);
  if (!rs) throw new HttpError(404, "NOT_FOUND", "rule set not found");
  if (rs.status === "published") throw new HttpError(409, "ALREADY_PUBLISHED", "rule set is immutable once published");
  if (rs.status !== "draft") throw new HttpError(409, "INVALID_STATE", "only a draft can be published");
  if (!rs.submittedBy) throw new HttpError(409, "NOT_SUBMITTED", "rule set must be submitted before publish");
  if (rs.submittedBy === ctx.actorId) {
    throw new HttpError(403, "MAKER_CHECKER", "publisher must differ from the submitter");
  }
  const accepted = await publish(ctx, COMMANDS.eligibilityRuleSetPublish, randomUUID(), { id });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "eligibility", id));
  return { ...accepted, id };
}

/** Evaluate an application/subject against a published rule set → reasoned outcome. */
export async function evaluate(ctx: RequestContext, body: EvaluateBody): Promise<Accepted> {
  const evalId = randomUUID();
  return publish(ctx, COMMANDS.eligibilityEvaluate, evalId, { id: evalId, ...body });
}

/** Officer decision on a manual-review evaluation. */
export async function decideReview(ctx: RequestContext, id: string, body: ReviewDecisionBody): Promise<Accepted> {
  const ev = await repo.findEvaluationById(id, ctx.tenantId);
  if (!ev) throw new HttpError(404, "NOT_FOUND", "evaluation not found");
  if (ev.reviewStatus !== "pending") throw new HttpError(409, "NOT_PENDING", "evaluation is not awaiting manual review");
  const accepted = await publish(ctx, COMMANDS.eligibilityReviewDecide, randomUUID(), { id, ...body });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "eligibility-eval", id));
  return { ...accepted, id };
}
