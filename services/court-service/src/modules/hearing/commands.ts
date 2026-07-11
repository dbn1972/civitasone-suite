import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import { deriveHearingId } from "./domain.js";
import {
  scheduleHearingBody, type ScheduleHearingBody,
  adjournHearingBody, type AdjournHearingBody,
} from "./validators.js";

export type ScheduleHearingResult = { accepted: true; hearingId: string };
export type AdjournHearingResult = { accepted: true; hearingId: string };

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

/** Adjourn a hearing (§20). messageId is idempotent per (hearing + expectedVersion). */
export async function adjournHearing(
  ctx: RequestContext, hearingId: string, input: AdjournHearingBody,
): Promise<AdjournHearingResult> {
  const body = adjournHearingBody.parse(input);
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
