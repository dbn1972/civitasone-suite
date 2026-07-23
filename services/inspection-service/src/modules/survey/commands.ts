/**
 * inspection-service: Survey module — command publishing helpers.
 *
 * _Requirements: SVC-104_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

// ── Payload types ─────────────────────────────────────────────────────────────

export interface SurveyCreatePayload {
  title: string;
  description?: string | undefined;
  targetEntityType: string;
  questionnaire: Array<{
    id: string;
    question: string;
    fieldType: string;
    required: boolean;
    options?: string[] | undefined;
  }>;
  samplingMethod: "random" | "stratified" | "systematic";
  sampleSizePercent: number;
  stratificationField?: string | undefined;
}

export interface SurveyUpdatePayload {
  surveyId: string;
  version: number;
  title?: string | undefined;
  description?: string | undefined;
  questionnaire?: Array<{
    id: string;
    question: string;
    fieldType: string;
    required: boolean;
    options?: string[] | undefined;
  }> | undefined;
  samplingMethod?: "random" | "stratified" | "systematic" | undefined;
  sampleSizePercent?: number | undefined;
  stratificationField?: string | undefined;
}

export interface SurveyActivatePayload {
  surveyId: string;
  entityIds: string[];
  entities?: Array<Record<string, unknown>> | undefined;
  seed: number;
}

export interface SurveyClosePayload {
  surveyId: string;
}

export interface SurveyResponseSubmitPayload {
  surveyId: string;
  entityId: string;
  inspectorId: string;
  answers: Record<string, unknown>;
  capturedAt: string;
  deviceId?: string | undefined;
  syncUploadId?: string | undefined;
}

export interface SurveyAggregatePayload {
  surveyId: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function envelope(
  ctx: RequestContext,
  type: string,
  payload: Record<string, unknown>,
) {
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

export async function publishSurveyCreate(
  payload: SurveyCreatePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.surveyCreate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.surveyCreate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishSurveyUpdate(
  payload: SurveyUpdatePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.surveyUpdate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.surveyUpdate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishSurveyActivate(
  payload: SurveyActivatePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.surveyActivate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.surveyActivate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishSurveyClose(
  payload: SurveyClosePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.surveyClose, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.surveyClose, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishSurveyResponseSubmit(
  payload: SurveyResponseSubmitPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.surveyResponseSubmit, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.surveyResponseSubmit, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishSurveyAggregate(
  payload: SurveyAggregatePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.surveyAggregate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.surveyAggregate, msg);
  return { accepted: true, messageId: msg.messageId };
}
