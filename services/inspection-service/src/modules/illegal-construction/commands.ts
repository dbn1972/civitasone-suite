/**
 * inspection-service: Illegal Construction module — command publishing helpers.
 *
 * _Requirements: BRD 5.20 ILBLD-001..004_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

// ── Payload types ─────────────────────────────────────────────────────────────

export interface CreateCasePayload {
  reportedBy: string;
  location: Record<string, unknown>;
  buildingPermitRef?: string | undefined;
  ownerName: string;
  ownerContact?: string | undefined;
  violationType: string;
  description: string;
  photos?: unknown[] | undefined;
}

export interface InspectCasePayload {
  caseId: string;
  inspectionFindings: Record<string, unknown>;
  violationChecklist: unknown;
}

export interface ConfirmViolationPayload {
  caseId: string;
}

export interface IssueActionPayload {
  caseId: string;
  actionType: string;
  details?: Record<string, unknown> | undefined;
  fineAmountMinor?: string | undefined;
}

export interface EnforceActionPayload {
  actionId: string;
}

export interface RegularizeCasePayload {
  caseId: string;
  regularizationDetails: Record<string, unknown>;
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

export async function publishCreateCase(
  payload: CreateCasePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.illegalConstructionCaseCreate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.illegalConstructionCaseCreate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishInspectCase(
  payload: InspectCasePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.illegalConstructionInspect, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.illegalConstructionInspect, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishConfirmViolation(
  payload: ConfirmViolationPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.illegalConstructionConfirm, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.illegalConstructionConfirm, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishIssueAction(
  payload: IssueActionPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.illegalConstructionActionIssue, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.illegalConstructionActionIssue, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishEnforceAction(
  payload: EnforceActionPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.illegalConstructionActionEnforce, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.illegalConstructionActionEnforce, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishRegularizeCase(
  payload: RegularizeCasePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.illegalConstructionRegularize, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.illegalConstructionRegularize, msg);
  return { accepted: true, messageId: msg.messageId };
}
