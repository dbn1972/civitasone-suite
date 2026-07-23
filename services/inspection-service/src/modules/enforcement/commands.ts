/**
 * inspection-service: Enforcement module — command publishing helpers.
 *
 * _Requirements: SVC-107_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

// ── Payload types ─────────────────────────────────────────────────────────────

export interface PenaltyRateCreatePayload {
  provisionId: string;
  effectiveFrom: string;
  effectiveTo?: string | undefined;
  amount: string; // bigint as string for transport
  currency?: string | undefined;
  description?: string | undefined;
}

export interface ShowCauseCreatePayload {
  findingId: string;
  entityId: string;
  issuedTo: string;
  responseDeadline: string;
}

export interface ShowCauseRespondPayload {
  showCauseId: string;
  responseText: string;
}

export interface PenaltyOrderCreatePayload {
  findingId: string;
  entityId: string;
  showCauseId?: string | undefined;
  penaltyRateId?: string | undefined;
  amount: string; // bigint as string
  currency?: string | undefined;
}

export interface PenaltyOrderIssuePayload {
  penaltyOrderId: string;
}

export interface ProsecutionReferPayload {
  penaltyOrderId: string;
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

export async function publishPenaltyRateCreate(
  payload: PenaltyRateCreatePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.penaltyRateCreate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.penaltyRateCreate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishShowCauseCreate(
  payload: ShowCauseCreatePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.showCauseCreate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.showCauseCreate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishShowCauseRespond(
  payload: ShowCauseRespondPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.showCauseRespond, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.showCauseRespond, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishPenaltyOrderCreate(
  payload: PenaltyOrderCreatePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.penaltyOrderCreate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.penaltyOrderCreate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishPenaltyOrderIssue(
  payload: PenaltyOrderIssuePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.penaltyOrderIssue, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.penaltyOrderIssue, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishProsecutionRefer(
  payload: ProsecutionReferPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.prosecutionRefer, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.prosecutionRefer, msg);
  return { accepted: true, messageId: msg.messageId };
}
