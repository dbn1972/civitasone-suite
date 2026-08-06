/**
 * G15 — MoU milestone governance: command publishers.
 *
 * Routes call these and return 202. Nothing here touches Postgres — every
 * write is a queue message handled by consumer.ts inside one transaction.
 *
 * Money crosses the queue as a decimal STRING of minor units so a JSON number
 * can never round a paise amount above 2^53.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type {
  CreateMilestoneBody,
  TransitionMilestoneBody,
  CreatePenaltyTermBody,
  ApplyPenaltyBody,
  CreateReviewScheduleBody,
  CompleteReviewBody,
} from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

function envelope(type: string, ctx: RequestContext, payload: Record<string, unknown>, messageId: string) {
  return {
    messageId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  };
}

export async function registerMilestone(ctx: RequestContext, body: CreateMilestoneBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(
    COMMANDS.mouMilestoneRegister,
    envelope(
      COMMANDS.mouMilestoneRegister,
      ctx,
      {
        id,
        tenantId: ctx.tenantId,
        contractId: body.contractId,
        milestoneCode: body.milestoneCode,
        name: body.name,
        description: body.description,
        dueDate: body.dueDate,
        ordinal: body.ordinal,
        amountMinor: body.amountMinor === undefined || body.amountMinor === null ? null : body.amountMinor.toString(),
        currency: body.currency,
      },
      id,
    ),
  );
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function transitionMilestone(
  ctx: RequestContext,
  id: string,
  contractId: string,
  body: TransitionMilestoneBody,
): Promise<Accepted> {
  await queue.publish(
    COMMANDS.mouMilestoneTransition,
    envelope(
      COMMANDS.mouMilestoneTransition,
      ctx,
      {
        id,
        tenantId: ctx.tenantId,
        contractId,
        version: body.version,
        toStatus: body.toStatus,
        ...(body.completedAt !== undefined && { completedAt: body.completedAt }),
        ...(body.waiverReason !== undefined && { waiverReason: body.waiverReason }),
      },
      randomUUID(),
    ),
  );
  await cache.invalidate(cache.makeKey(ctx.tenantId, "mou-milestone", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createPenaltyTerm(ctx: RequestContext, body: CreatePenaltyTermBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(
    COMMANDS.mouPenaltyTermCreate,
    envelope(
      COMMANDS.mouPenaltyTermCreate,
      ctx,
      {
        id,
        tenantId: ctx.tenantId,
        contractId: body.contractId,
        termCode: body.termCode,
        description: body.description,
        triggerType: body.triggerType,
        thresholdValue: body.thresholdValue,
        penaltyKind: body.penaltyKind,
        penaltyAmountMinor:
          body.penaltyAmountMinor === undefined || body.penaltyAmountMinor === null
            ? null
            : body.penaltyAmountMinor.toString(),
        penaltyRateBps: body.penaltyRateBps === undefined ? null : body.penaltyRateBps,
        maxPenaltyBps: body.maxPenaltyBps,
        currency: body.currency,
      },
      id,
    ),
  );
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function applyPenalty(ctx: RequestContext, body: ApplyPenaltyBody): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(
    COMMANDS.mouPenaltyApply,
    envelope(
      COMMANDS.mouPenaltyApply,
      ctx,
      {
        tenantId: ctx.tenantId,
        penaltyTermId: body.penaltyTermId,
        ...(body.milestoneId !== undefined && { milestoneId: body.milestoneId }),
        occurrenceRef: body.occurrenceRef,
        overdueDays: body.overdueDays,
        milestoneAmountMinor: body.milestoneAmountMinor.toString(),
      },
      messageId,
    ),
  );
  return { id: messageId, status: "accepted", correlationId: ctx.correlationId };
}

export async function scheduleReview(ctx: RequestContext, body: CreateReviewScheduleBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(
    COMMANDS.mouReviewSchedule,
    envelope(
      COMMANDS.mouReviewSchedule,
      ctx,
      {
        id,
        tenantId: ctx.tenantId,
        contractId: body.contractId,
        reviewCode: body.reviewCode,
        cadence: body.cadence,
        nextReviewDate: body.nextReviewDate,
        reviewerRole: body.reviewerRole,
        ...(body.notes !== undefined && { notes: body.notes }),
      },
      id,
    ),
  );
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function completeReview(ctx: RequestContext, id: string, body: CompleteReviewBody): Promise<Accepted> {
  await queue.publish(
    COMMANDS.mouReviewComplete,
    envelope(
      COMMANDS.mouReviewComplete,
      ctx,
      {
        id,
        tenantId: ctx.tenantId,
        version: body.version,
        ...(body.notes !== undefined && { notes: body.notes }),
      },
      randomUUID(),
    ),
  );
  await cache.invalidate(cache.makeKey(ctx.tenantId, "mou-review", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
