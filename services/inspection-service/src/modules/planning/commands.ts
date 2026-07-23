/**
 * inspection-service: planning module — command publishing helpers.
 *
 * Each function takes a payload + RequestContext, wraps it in the standard
 * CivitasOne CommandEnvelope, and publishes to the queue. Routes call these
 * after zod validation, then return 202 Accepted.
 *
 * Additionally includes `submitPlanForApproval` which publishes to the
 * cross-service `workflow.command.submit` topic for multi-level approval.
 *
 * Envelope shape: { messageId, type, tenantId, actorId, correlationId,
 *   schemaVersion, payload }
 *
 * _Requirements: 3.4, 3.5, 3.6, 3.7_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

// ── Payload types ─────────────────────────────────────────────────────────────

export interface PlanCreatePayload {
  name: string;
  periodStart: string;
  periodEnd: string;
  riskThreshold?: number;
  selectionCriteria?: Record<string, unknown>;
  entityIds: string[];
  description?: string;
}

export interface PlanModifyPayload {
  planId: string;
  version: number;
  patch: Record<string, unknown>;
}

export interface PlanSubmitApprovalPayload {
  planId: string;
  version: number;
}

export interface PlanActivatePayload {
  planId: string;
  version: number;
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

export async function publishPlanCreate(
  payload: PlanCreatePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.planCreate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.planCreate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishPlanModify(
  payload: PlanModifyPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.planModify, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.planModify, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishPlanSubmitApproval(
  payload: PlanSubmitApprovalPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.planSubmitApproval, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.planSubmitApproval, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishPlanActivate(
  payload: PlanActivatePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.planActivate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.planActivate, msg);
  return { accepted: true, messageId: msg.messageId };
}

/**
 * Publish a workflow submission to workflow-service for plan approval.
 * Cross-service command: `workflow.command.submit`.
 */
export async function submitPlanForWorkflowApproval(
  ctx: RequestContext,
  planId: string,
): Promise<void> {
  await queue.publish("workflow.command.submit", {
    messageId: randomUUID(),
    type: "workflow.command.submit",
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      workflowType: "inspection_plan_approval",
      entityType: "inspection_plan",
      entityId: planId,
      callbackTopic: "inspection.plan.approval_decided",
    },
  });
}
