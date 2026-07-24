import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { HttpError } from "../../shared/context.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertRulesWellFormed, evaluateEligibility } from "./domain.js";
import type { CreateRuleSetBody, EvaluateBody, ReviewDecisionBody } from "./validators.js";

async function audit(tx: Parameters<typeof enqueue>[0], ctx: RequestContext, action: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: { service: "citizen", action, resourceType: "eligibility_rule_set", resourceId, outcome: "success" },
  });
}

/** Create a new DRAFT rule set at the next version for the service. */
export async function createRuleSet(ctx: RequestContext, body: CreateRuleSetBody): Promise<{ id: string; version: number; status: string }> {
  assertRulesWellFormed(body.rules);
  const id = randomUUID();
  const version = await db.transaction(async (tx) => {
    const next = (await repo.latestVersionForService(tx, ctx.tenantId, body.serviceId)) + 1;
    await repo.insertRuleSet(tx, {
      id, tenantId: ctx.tenantId, serviceId: body.serviceId, name: body.name,
      version: next, status: "draft", rules: body.rules,
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await audit(tx, ctx, "ruleset_create", id);
    return next;
  });
  return { id, version, status: "draft" };
}

/** Maker step — record the submitter requesting publication (does NOT publish). */
export async function submitRuleSet(ctx: RequestContext, id: string): Promise<{ id: string; status: string }> {
  return db.transaction(async (tx) => {
    const rs = await repo.findRuleSetByIdTx(tx, id, ctx.tenantId);
    if (!rs) throw new HttpError(404, "NOT_FOUND", "rule set not found");
    if (rs.status !== "draft") throw new HttpError(409, "INVALID_STATE", "only a draft can be submitted");
    await repo.updateRuleSet(tx, id, ctx.tenantId, { submittedBy: ctx.actorId, updatedBy: ctx.actorId });
    await audit(tx, ctx, "ruleset_submit", id);
    return { id, status: "submitted" };
  });
}

/**
 * Checker step — publish (maker-checker: publisher MUST differ from submitter).
 * Publishing freezes the rule set (immutable). Emits a domain event via outbox.
 */
export async function publishRuleSet(ctx: RequestContext, id: string): Promise<{ id: string; status: string; version: number }> {
  return db.transaction(async (tx) => {
    const rs = await repo.findRuleSetByIdTx(tx, id, ctx.tenantId);
    if (!rs) throw new HttpError(404, "NOT_FOUND", "rule set not found");
    if (rs.status === "published") throw new HttpError(409, "ALREADY_PUBLISHED", "rule set is immutable once published");
    if (rs.status !== "draft") throw new HttpError(409, "INVALID_STATE", "only a draft can be published");
    if (!rs.submittedBy) throw new HttpError(409, "NOT_SUBMITTED", "rule set must be submitted before publish");
    // Maker-checker: the checker (publisher) must not be the maker (submitter).
    if (rs.submittedBy === ctx.actorId) {
      throw new HttpError(403, "MAKER_CHECKER", "publisher must differ from the submitter");
    }
    assertRulesWellFormed(rs.rules);
    await repo.updateRuleSet(tx, id, ctx.tenantId, {
      status: "published", publishedBy: ctx.actorId, publishedAt: new Date(), updatedBy: ctx.actorId,
    });
    await enqueue(tx, {
      topic: EVENTS.eligibilityRuleSetPublished, eventType: EVENTS.eligibilityRuleSetPublished,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: { id, serviceId: rs.serviceId, version: rs.version },
    });
    await audit(tx, ctx, "ruleset_publish", id);
    return { id, status: "published", version: rs.version };
  });
}

/** Evaluate an application/subject against a published rule set → reasoned outcome. */
export async function evaluate(ctx: RequestContext, body: EvaluateBody): Promise<{ id: string; outcome: string; reasons: unknown[]; reviewStatus: string }> {
  const evalId = randomUUID();
  return db.transaction(async (tx) => {
    let rs = body.ruleSetId ? await repo.findRuleSetByIdTx(tx, body.ruleSetId, ctx.tenantId) : null;
    if (!rs && body.serviceId) rs = await repo.findPublishedRuleSet(tx, ctx.tenantId, body.serviceId);
    if (!rs) throw new HttpError(404, "NO_RULE_SET", "no published rule set for evaluation");
    if (rs.status !== "published") throw new HttpError(409, "RULE_SET_NOT_PUBLISHED", "rule set is not published");

    const { outcome, reasons } = evaluateEligibility(rs.rules, body.subject);
    const reviewStatus = outcome === "refer_manual" ? "pending" : "none";
    await repo.insertEvaluation(tx, {
      id: evalId, tenantId: ctx.tenantId, ruleSetId: rs.id,
      applicationId: body.applicationId ?? null, subjectRef: body.subjectRef ?? null,
      subject: body.subject, outcome, reasons, reviewStatus,
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    return { id: evalId, outcome, reasons, reviewStatus };
  });
}

/** Officer decision on a manual-review evaluation. */
export async function decideReview(ctx: RequestContext, id: string, body: ReviewDecisionBody): Promise<{ id: string; reviewStatus: string; decision: string }> {
  return db.transaction(async (tx) => {
    const ev = await repo.findEvaluationByIdTx(tx, id, ctx.tenantId);
    if (!ev) throw new HttpError(404, "NOT_FOUND", "evaluation not found");
    if (ev.reviewStatus !== "pending") throw new HttpError(409, "NOT_PENDING", "evaluation is not awaiting manual review");
    await repo.updateEvaluation(tx, id, ctx.tenantId, {
      reviewStatus: "decided", reviewDecision: body.decision, reviewNote: body.note ?? null,
      reviewedBy: ctx.actorId, reviewedAt: new Date(), updatedBy: ctx.actorId,
    });
    return { id, reviewStatus: "decided", decision: body.decision };
  });
}
