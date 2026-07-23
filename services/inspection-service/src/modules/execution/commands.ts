/**
 * inspection-service: execution module — command publishing helpers.
 *
 * Each function takes a payload + RequestContext, wraps it in the standard
 * CivitasOne CommandEnvelope, and publishes to the queue. Routes call these
 * after zod validation, then return 202 Accepted.
 *
 * _Requirements: 8.1, 8.2, 8.3, 8.5, 8.6, 8.7, 8.8_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

// ── Payload types ─────────────────────────────────────────────────────────────

/** POST /inspections/:id/transition — trigger state transition. */
export interface InspectionTransitionPayload {
  inspectionId: string;
  targetState: string;
  remarks?: string | undefined;
}

/** POST /inspections/:id/submit-review — submit for review. */
export interface InspectionSubmitReviewPayload {
  inspectionId: string;
  reviewerId: string;
}

/** POST /inspections/:id/finalize — finalize inspection. */
export interface InspectionFinalizePayload {
  inspectionId: string;
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

export async function publishInspectionTransition(
  payload: InspectionTransitionPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.inspectionTransition, {
    ...payload,
    tenantId: ctx.tenantId,
  });
  await queue.publish(COMMANDS.inspectionTransition, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishInspectionSubmitReview(
  payload: InspectionSubmitReviewPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.inspectionSubmitReview, {
    ...payload,
    tenantId: ctx.tenantId,
  });
  await queue.publish(COMMANDS.inspectionSubmitReview, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishInspectionFinalize(
  payload: InspectionFinalizePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.inspectionFinalize, {
    ...payload,
    tenantId: ctx.tenantId,
  });
  await queue.publish(COMMANDS.inspectionFinalize, msg);
  return { accepted: true, messageId: msg.messageId };
}
