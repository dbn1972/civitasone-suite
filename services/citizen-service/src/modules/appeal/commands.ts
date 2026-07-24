import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { HttpError } from "../../shared/context.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import {
  assertWithinFilingWindow, orderOutcome, canIssueOrder,
  DEFAULT_FILING_WINDOW_DAYS,
} from "./domain.js";
import type { FileAppealBody, AssignBody, ScheduleHearingBody, RecordHearingBody, PrepareOrderBody } from "./validators.js";

async function audit(tx: Parameters<typeof enqueue>[0], ctx: RequestContext, action: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: { service: "citizen", action, resourceType: "appeal", resourceId, outcome: "success" },
  });
}

/**
 * File an appeal against an application/decision. The filing window is validated
 * against the decision date; a late filing is rejected (422 FILING_WINDOW_EXPIRED).
 */
export async function fileAppeal(ctx: RequestContext, body: FileAppealBody): Promise<{ id: string; status: string; filingDeadline: string }> {
  const id = randomUUID();
  const windowDays = body.windowDays ?? DEFAULT_FILING_WINDOW_DAYS;
  let filingDeadline: string;
  try {
    ({ filingDeadline } = assertWithinFilingWindow(new Date(body.decisionDate), windowDays));
  } catch {
    throw new HttpError(422, "FILING_WINDOW_EXPIRED", `appeal must be filed within ${windowDays} days of the decision`);
  }
  await db.transaction(async (tx) => {
    await repo.insertAppeal(tx, {
      id, tenantId: ctx.tenantId, applicationId: body.applicationId ?? null,
      decisionRef: body.decisionRef ?? null, citizenId: body.citizenId ?? null,
      appealType: body.appealType, grounds: body.grounds,
      decisionDate: body.decisionDate, filingDeadline, status: "filed",
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await enqueue(tx, {
      topic: EVENTS.appealFiled, eventType: EVENTS.appealFiled,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: { id, applicationId: body.applicationId ?? null, appealType: body.appealType },
    });
    await audit(tx, ctx, "file", id);
  });
  return { id, status: "filed", filingDeadline };
}

/** Assign an appellate authority (filed → assigned). */
export async function assign(ctx: RequestContext, id: string, body: AssignBody): Promise<{ id: string; status: string }> {
  return db.transaction(async (tx) => {
    const ap = await repo.findAppealByIdTx(tx, id, ctx.tenantId);
    if (!ap) throw new HttpError(404, "NOT_FOUND", "appeal not found");
    if (ap.status !== "filed") throw new HttpError(409, "INVALID_STATE", "only a filed appeal can be assigned");
    await repo.updateAppeal(tx, id, ctx.tenantId, {
      appellateAuthorityId: body.appellateAuthorityId, status: "assigned", updatedBy: ctx.actorId,
    });
    await audit(tx, ctx, "assign", id);
    return { id, status: "assigned" };
  });
}

/** Transfer the case records to the appellate authority. */
export async function transferRecords(ctx: RequestContext, id: string): Promise<{ id: string; recordsTransferred: boolean }> {
  return db.transaction(async (tx) => {
    const ap = await repo.findAppealByIdTx(tx, id, ctx.tenantId);
    if (!ap) throw new HttpError(404, "NOT_FOUND", "appeal not found");
    if (!ap.appellateAuthorityId) throw new HttpError(409, "NOT_ASSIGNED", "assign an appellate authority before transferring records");
    await repo.updateAppeal(tx, id, ctx.tenantId, {
      recordsTransferred: true, recordsTransferredAt: new Date(), updatedBy: ctx.actorId,
    });
    await audit(tx, ctx, "transfer_records", id);
    return { id, recordsTransferred: true };
  });
}

/** Schedule a hearing (assigned → hearing). */
export async function scheduleHearing(ctx: RequestContext, id: string, body: ScheduleHearingBody): Promise<{ id: string; hearingId: string; status: string }> {
  const hearingId = randomUUID();
  return db.transaction(async (tx) => {
    const ap = await repo.findAppealByIdTx(tx, id, ctx.tenantId);
    if (!ap) throw new HttpError(404, "NOT_FOUND", "appeal not found");
    if (ap.status !== "assigned" && ap.status !== "hearing") {
      throw new HttpError(409, "INVALID_STATE", "appeal must be assigned before a hearing is scheduled");
    }
    await repo.insertHearing(tx, {
      id: hearingId, tenantId: ctx.tenantId, appealId: id,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null, mode: body.mode,
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    if (ap.status !== "hearing") await repo.updateAppeal(tx, id, ctx.tenantId, { status: "hearing", updatedBy: ctx.actorId });
    await audit(tx, ctx, "schedule_hearing", id);
    return { id, hearingId, status: "hearing" };
  });
}

/** Record the outcome/minutes of a held hearing. */
export async function recordHearing(ctx: RequestContext, id: string, body: RecordHearingBody): Promise<{ id: string; hearingId: string }> {
  return db.transaction(async (tx) => {
    const ap = await repo.findAppealByIdTx(tx, id, ctx.tenantId);
    if (!ap) throw new HttpError(404, "NOT_FOUND", "appeal not found");
    const hearings = await repo.listHearingsTx(tx, ctx.tenantId, id);
    const h = hearings.find((x) => x.id === body.hearingId);
    if (!h) throw new HttpError(404, "HEARING_NOT_FOUND", "hearing not found for this appeal");
    await repo.updateHearing(tx, body.hearingId, ctx.tenantId, { record: body.record, heldAt: new Date(), updatedBy: ctx.actorId });
    await audit(tx, ctx, "record_hearing", id);
    return { id, hearingId: body.hearingId };
  });
}

/**
 * Maker step — prepare (draft) the appellate order. Records prepared_by; does
 * NOT finalise the outcome. An order can only be prepared once the appeal is
 * under hearing/assigned.
 */
export async function prepareOrder(ctx: RequestContext, id: string, body: PrepareOrderBody): Promise<{ id: string; orderType: string; prepared: boolean }> {
  return db.transaction(async (tx) => {
    const ap = await repo.findAppealByIdTx(tx, id, ctx.tenantId);
    if (!ap) throw new HttpError(404, "NOT_FOUND", "appeal not found");
    if (!canIssueOrder(ap.status)) throw new HttpError(409, "INVALID_STATE", "appeal must be heard before an order is prepared");
    if (body.orderType === "remanded" && !body.remandTo) {
      throw new HttpError(422, "REMAND_TARGET_REQUIRED", "a remand order requires a remandTo target");
    }
    await repo.updateAppeal(tx, id, ctx.tenantId, {
      orderType: body.orderType, orderNote: body.orderNote, remandTo: body.remandTo ?? null,
      preparedBy: ctx.actorId, preparedAt: new Date(), updatedBy: ctx.actorId,
    });
    await audit(tx, ctx, "prepare_order", id);
    return { id, orderType: body.orderType, prepared: true };
  });
}

/**
 * Checker step — issue the prepared order (maker-checker: the issuer MUST differ
 * from the preparer). Finalises the appeal (decided / remanded) and emits the
 * outcome via the transactional outbox.
 */
export async function issueOrder(ctx: RequestContext, id: string): Promise<{ id: string; status: string; outcome: string }> {
  return db.transaction(async (tx) => {
    const ap = await repo.findAppealByIdTx(tx, id, ctx.tenantId);
    if (!ap) throw new HttpError(404, "NOT_FOUND", "appeal not found");
    if (!ap.orderType || !ap.preparedBy) throw new HttpError(409, "NOT_PREPARED", "order must be prepared before it is issued");
    if (ap.status === "decided" || ap.status === "remanded" || ap.status === "closed") {
      throw new HttpError(409, "ALREADY_DECIDED", "appeal order is already issued");
    }
    if (ap.preparedBy === ctx.actorId) {
      throw new HttpError(403, "MAKER_CHECKER", "the order issuer must differ from the preparer");
    }
    const { status, outcome } = orderOutcome(ap.orderType as "upheld" | "overturned" | "modified" | "remanded");
    await repo.updateAppeal(tx, id, ctx.tenantId, {
      status, outcome, decidedBy: ctx.actorId, decidedAt: new Date(), updatedBy: ctx.actorId,
    });
    await enqueue(tx, {
      topic: EVENTS.appealDecided, eventType: EVENTS.appealDecided,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: { id, applicationId: ap.applicationId, orderType: ap.orderType, outcome, remandTo: ap.remandTo },
    });
    if (ap.citizenId) {
      await enqueue(tx, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: buildNotificationPayload({
          eventType: EVENTS.appealDecided,
          recipient: ap.citizenId, recipientId: ap.citizenId,
          variables: { appealId: id, outcome },
        }) as unknown as Record<string, unknown>,
      });
    }
    await audit(tx, ctx, "issue_order", id);
    return { id, status, outcome };
  });
}
