/**
 * inspection-service: findings module — command publishing helpers.
 *
 * Each function takes a payload + RequestContext, wraps it in the standard
 * CivitasOne CommandEnvelope, and publishes to the queue. Routes call these
 * after zod validation, then return 202 Accepted.
 *
 * _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

// ── Payload types ─────────────────────────────────────────────────────────────

/** POST /findings — create a non-compliance finding (Req 9.1, 9.2, 9.3). */
export interface FindingCreatePayload {
  inspectionId: string;
  questionId?: string | undefined;
  provisionId: string;
  description: string;
  evidenceIds?: string[] | undefined;
}

/** POST /findings/:id/compliance-notice — create compliance notice (Req 9.4). */
export interface ComplianceNoticeCreatePayload {
  findingId: string;
  dueDate: string;
  requiredAction: string;
  responsibleParty: string;
}

/** POST /findings/:id/verify — verify finding resolved (Req 9.6). */
export interface FindingVerifyResolvedPayload {
  findingId: string;
  verificationEvidenceIds?: string[] | undefined;
  verifierNotes?: string | undefined;
}

/** DELETE /findings/:id — soft-delete finding (Req 9.8). */
export interface FindingSoftDeletePayload {
  findingId: string;
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

export async function publishFindingCreate(
  payload: FindingCreatePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.findingCreate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.findingCreate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishComplianceNoticeCreate(
  payload: ComplianceNoticeCreatePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.complianceNoticeCreate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.complianceNoticeCreate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishFindingVerifyResolved(
  payload: FindingVerifyResolvedPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.findingVerifyResolved, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.findingVerifyResolved, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishFindingSoftDelete(
  payload: FindingSoftDeletePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.findingSoftDelete, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.findingSoftDelete, msg);
  return { accepted: true, messageId: msg.messageId };
}

