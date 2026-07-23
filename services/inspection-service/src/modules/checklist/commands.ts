/**
 * inspection-service: checklist module — command publishing helpers.
 *
 * Each function takes a payload + RequestContext, wraps it in the standard
 * CivitasOne CommandEnvelope, and publishes to the queue. Routes call these
 * after zod validation, then return 202 Accepted.
 *
 * Envelope shape: { messageId, type, tenantId, actorId, correlationId,
 *   schemaVersion, payload }
 *
 * _Requirements: 5.1, 5.2, 5.3, 5.5_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

// ── Payload types ─────────────────────────────────────────────────────────────

export interface TemplateCreatePayload {
  name: string;
  inspectionTypeId?: string;
  sections: Array<{
    title: string;
    questions: Array<{
      fieldType: string;
      label: string;
      validationRules?: object;
      helpText?: string;
      weight?: number;
    }>;
  }>;
}

export interface TemplatePublishPayload {
  templateId: string;
  version: number;
}

export interface InstanceGeneratePayload {
  inspectionId: string;
  templateId: string;
  templateVersion: number;
}

export interface InstanceSubmitResponsePayload {
  instanceId: string;
  responses: Array<{
    questionId: string;
    value: unknown;
    capturedAt?: string;
  }>;
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

export async function publishTemplateCreate(
  payload: TemplateCreatePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.templateCreate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.templateCreate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishTemplatePublish(
  payload: TemplatePublishPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.templatePublish, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.templatePublish, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishInstanceGenerate(
  payload: InstanceGeneratePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.instanceGenerate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.instanceGenerate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishInstanceSubmitResponse(
  payload: InstanceSubmitResponsePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.instanceSubmitResponse, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.instanceSubmitResponse, msg);
  return { accepted: true, messageId: msg.messageId };
}
