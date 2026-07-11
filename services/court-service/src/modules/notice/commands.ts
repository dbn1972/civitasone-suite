import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import { deriveNoticeId, deriveServiceId } from "./domain.js";
import {
  issueNoticeBody, type IssueNoticeBody,
  recordServiceBody, type RecordServiceBody,
  updateNoticeStatusBody, type UpdateNoticeStatusBody,
} from "./validators.js";

export type IssueNoticeResult = { accepted: true; noticeId: string };
export type RecordServiceResult = { accepted: true; noticeId: string; serviceId: string };
export type UpdateNoticeStatusResult = { accepted: true; noticeId: string };

/** Issue a notice on a case (§21). Idempotent per (case + type + issue date). */
export async function issueNotice(
  ctx: RequestContext, caseId: string, input: IssueNoticeBody,
): Promise<IssueNoticeResult> {
  const body = issueNoticeBody.parse(input);
  const noticeId = deriveNoticeId(ctx.tenantId, caseId, body.noticeType, body.issueDate);

  await queue.publish(COMMANDS.issueNotice, {
    messageId: noticeId,
    type: COMMANDS.issueNotice,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...body, id: noticeId, caseId, tenantId: ctx.tenantId },
  });

  return { accepted: true, noticeId };
}

/** Record a service attempt against a notice (§21). Each attempt gets a distinct
 *  deterministic id (seq disambiguates attempts); messageId == serviceId so a
 *  redelivery of the SAME attempt is exactly-once. */
export async function recordService(
  ctx: RequestContext, noticeId: string, input: RecordServiceBody,
): Promise<RecordServiceResult> {
  const body = recordServiceBody.parse(input);
  const seq = Date.now();
  const serviceId = deriveServiceId(ctx.tenantId, noticeId, body.serviceMode, seq);

  await queue.publish(COMMANDS.recordService, {
    messageId: serviceId,
    type: COMMANDS.recordService,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...body, id: serviceId, noticeId, tenantId: ctx.tenantId },
  });

  return { accepted: true, noticeId, serviceId };
}

/** Update a notice's lifecycle status (§21). messageId is idempotent per
 *  (notice + expectedVersion). */
export async function updateNoticeStatus(
  ctx: RequestContext, noticeId: string, input: UpdateNoticeStatusBody,
): Promise<UpdateNoticeStatusResult> {
  const body = updateNoticeStatusBody.parse(input);
  const messageId = deterministicId(
    COURT_NAMESPACE,
    `${ctx.tenantId}:notice-status:${noticeId}:${body.expectedVersion}`,
  );

  await queue.publish(COMMANDS.updateNoticeStatus, {
    messageId,
    type: COMMANDS.updateNoticeStatus,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { noticeId, tenantId: ctx.tenantId, ...body },
  });

  return { accepted: true, noticeId };
}
