import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { assertRfqTransition, assertDistinctMakerChecker, DomainError } from "./domain.js";
import type { CreateRfqBody, AwardRfqBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

/** Queue-first RFQ issuance — mirrors indent/commands.ts createIndent(). */
export async function createRfq(ctx: RequestContext, body: CreateRfqBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.rfqCreate, {
    messageId: id, type: COMMANDS.rfqCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Queue-first vendor response to an RFQ. */
export async function respondToRfq(ctx: RequestContext, rfqId: string, body: import("./validators.js").RfqRespondBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.rfqRespond, {
    messageId: id, type: COMMANDS.rfqRespond,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, rfqId, vendorId: ctx.actorId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * DOM-011: close an issued RFQ (no more responses accepted). Synchronous
 * pre-check mirrors tender/commands.ts's publishTender/awardTender pattern:
 * validate existence + the transition against the CURRENT status before
 * enqueuing, so an invalid request gets an immediate 404/409 instead of
 * silently failing message processing later. The consumer re-checks under
 * the transaction lock as defense-in-depth (route check and consumer write
 * are not atomic -- same rationale as grn/domain.ts's assertGrnAmendable).
 */
export async function closeRfq(ctx: RequestContext, rfqId: string): Promise<Accepted> {
  const rfq = await repo.findRfqById(rfqId);
  if (!rfq || rfq.tenantId !== ctx.tenantId) {
    throw new HttpError(404, "NOT_FOUND", "RFQ not found");
  }
  try {
    assertRfqTransition(rfq.status, "closed");
  } catch (err) {
    if (err instanceof DomainError) throw new HttpError(409, err.code, err.message);
    throw err;
  }

  await queue.publish(COMMANDS.rfqClose, {
    messageId: randomUUID(), type: COMMANDS.rfqClose,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: rfqId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "rfq", rfqId));
  return { id: rfqId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * DOM-011: award a closed RFQ to one of its submitted responses. Segregation
 * of duties: reject self-award synchronously with 403 before enqueuing --
 * the award approver must differ from the RFQ creator, mirroring
 * tender/commands.ts's awardTender exactly (the award consumer re-checks
 * in-txn as defense-in-depth).
 */
export async function awardRfq(ctx: RequestContext, rfqId: string, body: AwardRfqBody): Promise<Accepted> {
  const rfq = await repo.findRfqById(rfqId);
  if (!rfq || rfq.tenantId !== ctx.tenantId) {
    throw new HttpError(404, "NOT_FOUND", "RFQ not found");
  }
  try {
    assertRfqTransition(rfq.status, "awarded");
    assertDistinctMakerChecker(rfq.createdBy, ctx.actorId);
  } catch (err) {
    if (err instanceof DomainError) {
      throw new HttpError(err.code === "SOD_VIOLATION" ? 403 : 409, err.code, err.message);
    }
    throw err;
  }

  await queue.publish(COMMANDS.rfqAward, {
    messageId: randomUUID(), type: COMMANDS.rfqAward,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: rfqId, tenantId: ctx.tenantId, responseId: body.responseId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "rfq", rfqId));
  return { id: rfqId, status: "accepted", correlationId: ctx.correlationId };
}
