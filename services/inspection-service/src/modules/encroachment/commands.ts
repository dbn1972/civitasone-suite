/**
 * inspection-service: Encroachment module — command publishing helpers.
 *
 * _Requirements: BRD 5.19 ENCR-001..004_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

// ── Payload types ─────────────────────────────────────────────────────────────

export interface CreateComplaintPayload {
  reportedBy: string;
  location: Record<string, unknown>;
  encroachmentType: string;
  description: string;
  photos?: unknown[] | undefined;
  landParcelRef?: string | undefined;
}

export interface VerifyComplaintPayload {
  complaintId: string;
  landVerificationReport: Record<string, unknown>;
}

export interface IssueNoticePayload {
  complaintId: string;
  noticeType: string;
  issuedTo: string;
  responseDeadline: string;
}

export interface ServeNoticePayload {
  noticeId: string;
}

export interface RecordNoticeResponsePayload {
  noticeId: string;
  responseText: string;
}

export interface ScheduleHearingPayload {
  complaintId: string;
  noticeId: string;
  hearingDate: string;
  hearingTime: string;
  venue: string;
  officerId: string;
}

export interface CompleteHearingPayload {
  hearingId: string;
  attendees?: unknown[] | undefined;
  proceedings: string;
  decision: string;
  fineAmountMinor?: string | undefined;
  nextHearingDate?: string | undefined;
}

export interface OrderRemovalPayload {
  complaintId: string;
  scheduledDate: string;
}

export interface AssignRemovalTeamPayload {
  removalId: string;
  teamMembers: unknown[];
  equipmentUsed?: string | undefined;
}

export interface CompleteRemovalPayload {
  removalId: string;
  completionReport: Record<string, unknown>;
  photos?: unknown[] | undefined;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function envelope(ctx: RequestContext, type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  };
}

// ── Publish functions ─────────────────────────────────────────────────────────

export async function publishCreateComplaint(
  payload: CreateComplaintPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.encroachmentComplaintCreate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.encroachmentComplaintCreate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishVerifyComplaint(
  payload: VerifyComplaintPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.encroachmentComplaintVerify, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.encroachmentComplaintVerify, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishIssueNotice(
  payload: IssueNoticePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.encroachmentNoticeIssue, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.encroachmentNoticeIssue, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishServeNotice(
  payload: ServeNoticePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.encroachmentNoticeServe, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.encroachmentNoticeServe, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishRecordNoticeResponse(
  payload: RecordNoticeResponsePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.encroachmentNoticeRespond, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.encroachmentNoticeRespond, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishScheduleHearing(
  payload: ScheduleHearingPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.encroachmentHearingSchedule, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.encroachmentHearingSchedule, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishCompleteHearing(
  payload: CompleteHearingPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.encroachmentHearingComplete, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.encroachmentHearingComplete, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishOrderRemoval(
  payload: OrderRemovalPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.encroachmentRemovalOrder, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.encroachmentRemovalOrder, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishAssignRemovalTeam(
  payload: AssignRemovalTeamPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.encroachmentRemovalAssignTeam, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.encroachmentRemovalAssignTeam, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishCompleteRemoval(
  payload: CompleteRemovalPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.encroachmentRemovalComplete, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.encroachmentRemovalComplete, msg);
  return { accepted: true, messageId: msg.messageId };
}
