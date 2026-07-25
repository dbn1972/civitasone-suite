import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./scorecard-repo.js";
import { assertDistinctIssuerDecider, ScorecardDomainError } from "./scorecard-domain.js";
import type {
  RecomputeScorecardBody, IssueShowCauseBody, RespondShowCauseBody,
  AppealShowCauseBody, DecideShowCauseBody,
} from "./scorecard-validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function recomputeScorecard(ctx: RequestContext, vendorId: string, body: RecomputeScorecardBody): Promise<Accepted> {
  await queue.publish(COMMANDS.vendorScorecardRecompute, {
    messageId: randomUUID(), type: COMMANDS.vendorScorecardRecompute,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { vendorId, tenantId: ctx.tenantId, source: "manual", ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "vendor_scorecard", vendorId));
  return { id: vendorId, status: "accepted", correlationId: ctx.correlationId };
}

export async function issueShowCause(ctx: RequestContext, vendorId: string, body: IssueShowCauseBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.vendorShowCauseIssue, {
    messageId: id, type: COMMANDS.vendorShowCauseIssue,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, vendorId, tenantId: ctx.tenantId, reason: body.reason },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

async function showCauseOr404(ctx: RequestContext, id: string) {
  const sc = await repo.findShowCauseById(id, ctx.tenantId);
  if (!sc) throw new HttpError(404, "NOT_FOUND", "show-cause not found");
  return sc;
}

export async function respondShowCause(ctx: RequestContext, id: string, body: RespondShowCauseBody): Promise<Accepted> {
  await showCauseOr404(ctx, id);
  await queue.publish(COMMANDS.vendorShowCauseRespond, {
    messageId: randomUUID(), type: COMMANDS.vendorShowCauseRespond,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, response: body.response },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function appealShowCause(ctx: RequestContext, id: string, body: AppealShowCauseBody): Promise<Accepted> {
  await showCauseOr404(ctx, id);
  await queue.publish(COMMANDS.vendorShowCauseAppeal, {
    messageId: randomUUID(), type: COMMANDS.vendorShowCauseAppeal,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, appealText: body.appealText },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function decideShowCause(ctx: RequestContext, id: string, body: DecideShowCauseBody): Promise<Accepted> {
  const sc = await showCauseOr404(ctx, id);
  // Maker-checker: the decider must differ from the issuer — reject with 403.
  try {
    assertDistinctIssuerDecider(sc.issuedBy, ctx.actorId);
  } catch (err) {
    if (err instanceof ScorecardDomainError) throw new HttpError(403, err.code, err.message);
    throw err;
  }
  await queue.publish(COMMANDS.vendorShowCauseDecide, {
    messageId: randomUUID(), type: COMMANDS.vendorShowCauseDecide,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, decision: body.decision, uphold: body.uphold },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
