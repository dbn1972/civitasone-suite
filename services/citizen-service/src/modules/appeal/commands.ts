import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import {
  assertWithinFilingWindow, canIssueOrder,
  DEFAULT_FILING_WINDOW_DAYS,
} from "./domain.js";
import type { FileAppealBody, AssignBody, ScheduleHearingBody, RecordHearingBody, PrepareOrderBody } from "./validators.js";

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

/**
 * File an appeal against an application/decision. The filing window is validated
 * against the decision date; a late filing is rejected (422 FILING_WINDOW_EXPIRED).
 */
export async function fileAppeal(
  ctx: RequestContext,
  body: FileAppealBody,
): Promise<Accepted & { filingDeadline: string }> {
  const id = randomUUID();
  const windowDays = body.windowDays ?? DEFAULT_FILING_WINDOW_DAYS;
  let filingDeadline: string;
  try {
    ({ filingDeadline } = assertWithinFilingWindow(new Date(body.decisionDate), windowDays));
  } catch {
    throw new HttpError(422, "FILING_WINDOW_EXPIRED", `appeal must be filed within ${windowDays} days of the decision`);
  }
  const accepted = await publish(ctx, COMMANDS.appealFile, id, {
    id,
    applicationId: body.applicationId ?? null,
    decisionRef: body.decisionRef ?? null,
    citizenId: body.citizenId ?? null,
    appealType: body.appealType,
    grounds: body.grounds,
    decisionDate: body.decisionDate,
    filingDeadline,
  });
  return { ...accepted, filingDeadline };
}

/** Assign an appellate authority (filed → assigned). */
export async function assign(ctx: RequestContext, id: string, body: AssignBody): Promise<Accepted> {
  const ap = await repo.findAppealById(id, ctx.tenantId);
  if (!ap) throw new HttpError(404, "NOT_FOUND", "appeal not found");
  if (ap.status !== "filed") throw new HttpError(409, "INVALID_STATE", "only a filed appeal can be assigned");
  const accepted = await publish(ctx, COMMANDS.appealAssign, randomUUID(), { id, ...body });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "appeal", id));
  return { ...accepted, id };
}

/** Transfer the case records to the appellate authority. */
export async function transferRecords(ctx: RequestContext, id: string): Promise<Accepted> {
  const ap = await repo.findAppealById(id, ctx.tenantId);
  if (!ap) throw new HttpError(404, "NOT_FOUND", "appeal not found");
  if (!ap.appellateAuthorityId) throw new HttpError(409, "NOT_ASSIGNED", "assign an appellate authority before transferring records");
  const accepted = await publish(ctx, COMMANDS.appealTransferRecords, randomUUID(), { id });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "appeal", id));
  return { ...accepted, id };
}

/** Schedule a hearing (assigned → hearing). */
export async function scheduleHearing(
  ctx: RequestContext, id: string, body: ScheduleHearingBody,
): Promise<Accepted & { hearingId: string; data: { id: string; hearingId: string } }> {
  const ap = await repo.findAppealById(id, ctx.tenantId);
  if (!ap) throw new HttpError(404, "NOT_FOUND", "appeal not found");
  if (ap.status !== "assigned" && ap.status !== "hearing") {
    throw new HttpError(409, "INVALID_STATE", "appeal must be assigned before a hearing is scheduled");
  }
  const hearingId = randomUUID();
  const accepted = await publish(ctx, COMMANDS.appealScheduleHearing, hearingId, { id, hearingId, ...body });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "appeal", id));
  // `acceptedResponseSchema` only declares {id, status, correlationId,
  // data:{id}.passthrough()} — a bare top-level `hearingId` gets silently
  // stripped by sendAccepted()'s schema.parse(). It has to travel inside
  // `data` (passthrough) to reach the caller; see commit 62ed6fd4 (admin F3
  // envelope fix) for the identical bug in another service.
  return { ...accepted, id, hearingId, data: { id, hearingId } };
}

/** Record the outcome/minutes of a held hearing. */
export async function recordHearing(
  ctx: RequestContext, id: string, body: RecordHearingBody,
): Promise<Accepted & { hearingId: string }> {
  const ap = await repo.findAppealById(id, ctx.tenantId);
  if (!ap) throw new HttpError(404, "NOT_FOUND", "appeal not found");
  const hearings = await repo.listHearings(ctx.tenantId, id);
  const h = hearings.find((x) => x.id === body.hearingId);
  if (!h) throw new HttpError(404, "HEARING_NOT_FOUND", "hearing not found for this appeal");
  const accepted = await publish(ctx, COMMANDS.appealRecordHearing, randomUUID(), { id, ...body });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "appeal", id));
  return { ...accepted, id, hearingId: body.hearingId };
}

/** Maker step — prepare (draft) the appellate order. */
export async function prepareOrder(
  ctx: RequestContext, id: string, body: PrepareOrderBody,
): Promise<Accepted> {
  const ap = await repo.findAppealById(id, ctx.tenantId);
  if (!ap) throw new HttpError(404, "NOT_FOUND", "appeal not found");
  if (!canIssueOrder(ap.status)) throw new HttpError(409, "INVALID_STATE", "appeal must be heard before an order is prepared");
  if (body.orderType === "remanded" && !body.remandTo) {
    throw new HttpError(422, "REMAND_TARGET_REQUIRED", "a remand order requires a remandTo target");
  }
  const accepted = await publish(ctx, COMMANDS.appealPrepareOrder, randomUUID(), { id, ...body });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "appeal", id));
  return { ...accepted, id };
}

/** Checker step — issue the prepared order (maker-checker). */
export async function issueOrder(ctx: RequestContext, id: string): Promise<Accepted> {
  const ap = await repo.findAppealById(id, ctx.tenantId);
  if (!ap) throw new HttpError(404, "NOT_FOUND", "appeal not found");
  if (!ap.orderType || !ap.preparedBy) throw new HttpError(409, "NOT_PREPARED", "order must be prepared before it is issued");
  if (ap.status === "decided" || ap.status === "remanded" || ap.status === "closed") {
    throw new HttpError(409, "ALREADY_DECIDED", "appeal order is already issued");
  }
  if (ap.preparedBy === ctx.actorId) {
    throw new HttpError(403, "MAKER_CHECKER", "the order issuer must differ from the preparer");
  }
  const accepted = await publish(ctx, COMMANDS.appealIssueOrder, randomUUID(), { id });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "appeal", id));
  return { ...accepted, id };
}
