/**
 * inspection-service: CAPA module — command publishing helpers.
 *
 * Each function takes a payload + RequestContext, wraps it in the standard
 * CivitasOne CommandEnvelope, and publishes to the queue. Routes call these
 * after zod validation, then return 202 Accepted.
 *
 * _Requirements: SVC-106_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

// ── Payload types ─────────────────────────────────────────────────────────────

export interface CapaCreatePayload {
  findingId: string;
  type: string;
  description: string;
  ownerId?: string | undefined;
  dueDate?: string | undefined;
}

export interface CapaUpdatePayload {
  capaId: string;
  ownerId?: string | undefined;
  dueDate?: string | undefined;
  description?: string | undefined;
  version: number;
}

export interface CapaStartPayload {
  capaId: string;
}

export interface CapaCompletePayload {
  capaId: string;
  evidenceOfClosure: unknown[];
}

export interface CapaVerifyPayload {
  capaId: string;
  effectivenessVerified: boolean;
}

export interface CapaTriggerReinspectionPayload {
  capaId: string;
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

export async function publishCapaCreate(
  payload: CapaCreatePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.capaCreate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.capaCreate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishCapaUpdate(
  payload: CapaUpdatePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.capaUpdate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.capaUpdate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishCapaStart(
  payload: CapaStartPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.capaStart, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.capaStart, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishCapaComplete(
  payload: CapaCompletePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.capaComplete, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.capaComplete, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishCapaVerify(
  payload: CapaVerifyPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.capaVerify, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.capaVerify, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishCapaTriggerReinspection(
  payload: CapaTriggerReinspectionPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.capaTriggerReinspection, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.capaTriggerReinspection, msg);
  return { accepted: true, messageId: msg.messageId };
}
