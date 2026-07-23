/**
 * inspection-service: risk module — command publishing helpers.
 *
 * Each function takes a payload + RequestContext, wraps it in the standard
 * CivitasOne CommandEnvelope, and publishes to the queue. Routes call these
 * after zod validation, then return 202 Accepted.
 *
 * Envelope shape: { messageId, type, tenantId, actorId, correlationId,
 *   schemaVersion, payload }
 *
 * _Requirements: 3.1, 3.2, 3.3_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

// ── Payload types ─────────────────────────────────────────────────────────────

export interface RiskModelConfigurePayload {
  name: string;
  description?: string | undefined;
  factors: Array<{
    factorName: string;
    weight: number;
    scoringFunction: string;
    dataSource: string;
  }>;
}

export interface RiskScoreComputePayload {
  entityId: string;
  modelId?: string | undefined;
}

export interface RiskScoreBatchComputePayload {
  entityIds?: string[] | undefined;
  modelId?: string | undefined;
  riskCategoryFilter?: string | undefined;
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

export async function publishRiskModelConfigure(
  payload: RiskModelConfigurePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.riskModelConfigure, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.riskModelConfigure, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishRiskScoreCompute(
  payload: RiskScoreComputePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.riskScoreCompute, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.riskScoreCompute, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishRiskScoreBatchCompute(
  payload: RiskScoreBatchComputePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.riskScoreBatchCompute, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.riskScoreBatchCompute, msg);
  return { accepted: true, messageId: msg.messageId };
}
