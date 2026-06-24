import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { assertDistinctMakerChecker, assertTechEvaluatorDistinct, DomainError } from "./domain.js";
import type { CreateTenderBody, SubmitBidBody, TechEvaluateBody, AwardTenderBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createTender(ctx: RequestContext, body: CreateTenderBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.tenderCreate, {
    messageId: id, type: COMMANDS.tenderCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function publishTender(ctx: RequestContext, tenderId: string): Promise<Accepted> {
  await queue.publish(COMMANDS.tenderPublish, {
    messageId: randomUUID(), type: COMMANDS.tenderPublish,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: tenderId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "tender", tenderId));
  return { id: tenderId, status: "accepted", correlationId: ctx.correlationId };
}

export async function submitBid(ctx: RequestContext, tenderId: string, body: SubmitBidBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.tenderBidSubmit, {
    messageId: id, type: COMMANDS.tenderBidSubmit,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenderId, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function technicalEvaluate(ctx: RequestContext, tenderId: string, body: TechEvaluateBody): Promise<Accepted> {
  await queue.publish(COMMANDS.tenderTechEvaluate, {
    messageId: randomUUID(), type: COMMANDS.tenderTechEvaluate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: tenderId, tenantId: ctx.tenantId, results: body.results },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "tender", tenderId));
  return { id: tenderId, status: "accepted", correlationId: ctx.correlationId };
}

/** Open ALL financial envelopes for technically-qualified bids of a tender. */
export async function openFinancials(ctx: RequestContext, tenderId: string): Promise<Accepted> {
  await queue.publish(COMMANDS.tenderFinancialOpen, {
    messageId: randomUUID(), type: COMMANDS.tenderFinancialOpen,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: tenderId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "tender", tenderId));
  return { id: tenderId, status: "accepted", correlationId: ctx.correlationId };
}

/** Determine L1 and award → emit PO creation. */
export async function awardTender(ctx: RequestContext, tenderId: string, body: AwardTenderBody = {}): Promise<Accepted> {
  // C1: Segregation of duties — reject self-award synchronously with 403 before
  // enqueuing. The award approver must differ from the tender creator and the
  // technical evaluator. (The award consumer re-checks in-txn as defense-in-depth.)
  const tender = await repo.findTenderById(tenderId);
  if (!tender || tender.tenantId !== ctx.tenantId) {
    throw new HttpError(404, "NOT_FOUND", "tender not found");
  }
  try {
    assertDistinctMakerChecker(tender.createdBy, ctx.actorId);
    if (tender.techEvaluatedBy) assertTechEvaluatorDistinct(tender.techEvaluatedBy, ctx.actorId);
  } catch (err) {
    if (err instanceof DomainError) throw new HttpError(403, err.code, err.message);
    throw err;
  }

  await queue.publish(COMMANDS.tenderAward, {
    messageId: randomUUID(), type: COMMANDS.tenderAward,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: tenderId, tenantId: ctx.tenantId, ...(body.sanctionRef ? { sanctionRef: body.sanctionRef } : {}) },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "tender", tenderId));
  return { id: tenderId, status: "accepted", correlationId: ctx.correlationId };
}
