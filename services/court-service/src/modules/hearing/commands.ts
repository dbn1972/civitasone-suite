import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import { deriveHearingId, assertTransition } from "./domain.js";
import { getHearingById } from "./repo.js";
import { HttpError } from "../../shared/context.js";
import {
  scheduleHearingBody, type ScheduleHearingBody,
  adjournHearingBody, type AdjournHearingBody,
  recordHearingOutcomeBody, type RecordHearingOutcomeBody,
} from "./validators.js";

export type ScheduleHearingResult = { accepted: true; hearingId: string };
export type AdjournHearingResult = { accepted: true; hearingId: string };
export type RecordHearingOutcomeResult = { accepted: true; hearingId: string };

/** Schedule a hearing (§19). Idempotent per (case + scheduled instant). */
export async function scheduleHearing(
  ctx: RequestContext, caseId: string, input: ScheduleHearingBody,
): Promise<ScheduleHearingResult> {
  const body = scheduleHearingBody.parse(input);
  const scheduledAtIso = new Date(body.scheduledAt).toISOString();
  const hearingId = deriveHearingId(ctx.tenantId, caseId, scheduledAtIso);

  await queue.publish(COMMANDS.scheduleHearing, {
    messageId: hearingId,
    type: COMMANDS.scheduleHearing,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...body, scheduledAt: scheduledAtIso, id: hearingId, caseId, tenantId: ctx.tenantId },
  });

  return { accepted: true, hearingId };
}

/**
 * Adjourn a hearing (§20). messageId is idempotent per (hearing + expectedVersion).
 *
 * Synchronous pre-check mirrors the consumer's own checks exactly (same
 * assertTransition, same order) so an illegal transition (e.g. adjourning an
 * already-held hearing) is an immediate, honest 4xx instead of a 202 that
 * silently dead-letters -- confirmed live during the deep-verification pass
 * that produced this fix. The consumer's identical checks remain the
 * authoritative backstop for the race window between this read and the write.
 */
export async function adjournHearing(
  ctx: RequestContext, hearingId: string, input: AdjournHearingBody,
): Promise<AdjournHearingResult> {
  const body = adjournHearingBody.parse(input);

  const current = await getHearingById(ctx.tenantId, hearingId);
  if (!current) throw new HttpError(404, "HEARING_NOT_FOUND", `Hearing not found: ${hearingId}`);
  if (current.status !== "adjourned") {
    if (current.version !== body.expectedVersion) {
      throw new HttpError(
        409, "VERSION_CONFLICT",
        `Expected version ${body.expectedVersion}, found ${current.version}`,
      );
    }
    try {
      assertTransition(current.status, "adjourned");
    } catch (e) {
      throw new HttpError(409, "ILLEGAL_TRANSITION", (e as Error).message);
    }
  }

  const messageId = deterministicId(
    COURT_NAMESPACE,
    `${ctx.tenantId}:hearing-adjourn:${hearingId}:${body.expectedVersion}`,
  );

  await queue.publish(COMMANDS.adjournHearing, {
    messageId,
    type: COMMANDS.adjournHearing,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { hearingId, tenantId: ctx.tenantId, ...body },
  });

  return { accepted: true, hearingId };
}

/**
 * Record a hearing outcome (§20). messageId is idempotent per (hearing + expectedVersion).
 * Synchronous pre-check -- see adjournHearing's doc comment for why.
 */
export async function recordHearingOutcome(
  ctx: RequestContext, hearingId: string, input: RecordHearingOutcomeBody,
): Promise<RecordHearingOutcomeResult> {
  const body = recordHearingOutcomeBody.parse(input);

  const current = await getHearingById(ctx.tenantId, hearingId);
  if (!current) throw new HttpError(404, "HEARING_NOT_FOUND", `Hearing not found: ${hearingId}`);
  if (current.status !== body.outcome) {
    if (current.version !== body.expectedVersion) {
      throw new HttpError(
        409, "VERSION_CONFLICT",
        `Expected version ${body.expectedVersion}, found ${current.version}`,
      );
    }
    try {
      assertTransition(current.status, body.outcome);
    } catch (e) {
      throw new HttpError(409, "ILLEGAL_TRANSITION", (e as Error).message);
    }
  }

  const messageId = deterministicId(
    COURT_NAMESPACE,
    `${ctx.tenantId}:hearing-outcome:${hearingId}:${body.expectedVersion}`,
  );

  await queue.publish(COMMANDS.recordHearingOutcome, {
    messageId,
    type: COMMANDS.recordHearingOutcome,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { hearingId, tenantId: ctx.tenantId, ...body },
  });

  return { accepted: true, hearingId };
}
