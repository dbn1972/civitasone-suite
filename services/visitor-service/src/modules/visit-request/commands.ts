/**
 * visitor-service: visit-request command publishers.
 *
 * Thin CQRS publishers (route → zod validate → publish → 202 pattern, per
 * structure.md), following the exact shape of
 * `modules/blacklist/commands.ts`. `routes.ts` (Task 6.10) is the caller;
 * `consumer.ts` (Task 6.11) is the eventual handler.
 *
 * `visitRequestAutoReject` has no route caller yet — it is invoked by the
 * scheduled auto-reject worker (Task 6.12) once `domain.ts#isAutoRejectDue`
 * flags a `pending_approval` request that has been open for >24h.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface VisitRequestCreateInput {
  locationId: string;
  visitorName: string;
  visitorPhone: string;
  visitorEmail?: string | null;
  purpose: string;
  hostEmployeeId: string;
  scheduledAt: string; // ISO timestamp
  passType?: "single" | "multi_day" | "recurring" | "event";
  identityDocType?: string | null;
  identityDocRef?: string | null;
  visitorCategory?: "standard" | "vip" | "contractor" | "delegation";
  source?: "portal" | "host_preregister" | "kiosk" | "mobile";
  permittedAreas?: string[];
  /** Fix 3 — fuzzy/alias screening REVIEW flag resolved by the route before publish. */
  screeningReview?: boolean;
  screeningReviewNote?: string | null;
}

/**
 * Requirement 1.1: submits a new visit request. The route handler (Task
 * 6.10) has already run the synchronous blacklist screen before calling
 * this — a rejected/blocked visitor never reaches this publisher.
 */
export async function visitRequestCreate(ctx: RequestContext, input: VisitRequestCreateInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.visitRequestCreate, {
    messageId: id,
    type: COMMANDS.visitRequestCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      locationId: input.locationId,
      visitorName: input.visitorName,
      visitorPhone: input.visitorPhone,
      visitorEmail: input.visitorEmail ?? null,
      purpose: input.purpose,
      hostEmployeeId: input.hostEmployeeId,
      scheduledAt: input.scheduledAt,
      passType: input.passType ?? "single",
      identityDocType: input.identityDocType ?? null,
      identityDocRef: input.identityDocRef ?? null,
      visitorCategory: input.visitorCategory ?? "standard",
      source: input.source ?? "portal",
      permittedAreas: input.permittedAreas ?? [],
      screeningReview: input.screeningReview ?? false,
      screeningReviewNote: input.screeningReviewNote ?? null,
      createdBy: ctx.actorId,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export interface VisitRequestApproveInput {
  requestId: string;
}

/** Requirement 1.6/3.1: host (or workflow) approves a pending/pre-approved visit request. */
export async function visitRequestApprove(ctx: RequestContext, input: VisitRequestApproveInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.visitRequestApprove, {
    messageId,
    type: COMMANDS.visitRequestApprove,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id: input.requestId, tenantId: ctx.tenantId },
  });
  return { id: input.requestId, status: "accepted", correlationId: ctx.correlationId };
}

export interface VisitRequestRejectInput {
  requestId: string;
  reason: string;
}

/** Requirement 3.4/1.6: host rejects a pending/pre-approved visit request, storing a reason. */
export async function visitRequestReject(ctx: RequestContext, input: VisitRequestRejectInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.visitRequestReject, {
    messageId,
    type: COMMANDS.visitRequestReject,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id: input.requestId, tenantId: ctx.tenantId, reason: input.reason },
  });
  return { id: input.requestId, status: "accepted", correlationId: ctx.correlationId };
}

export interface VisitRequestCancelInput {
  requestId: string;
}

/** Requirement 1.6: host or visitor withdraws a request before check-in (soft-delete via command). */
export async function visitRequestCancel(ctx: RequestContext, input: VisitRequestCancelInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.visitRequestCancel, {
    messageId,
    type: COMMANDS.visitRequestCancel,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id: input.requestId, tenantId: ctx.tenantId },
  });
  return { id: input.requestId, status: "accepted", correlationId: ctx.correlationId };
}

export interface VisitRequestAutoRejectInput {
  requestId: string;
}

/**
 * Requirement 3.4/3.5 (Property 7): published by the scheduled auto-reject
 * worker (Task 6.12) for a `pending_approval` request that has been open
 * for more than 24h — no route calls this yet.
 */
export async function visitRequestAutoReject(ctx: RequestContext, input: VisitRequestAutoRejectInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.visitRequestAutoReject, {
    messageId,
    type: COMMANDS.visitRequestAutoReject,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id: input.requestId, tenantId: ctx.tenantId },
  });
  return { id: input.requestId, status: "accepted", correlationId: ctx.correlationId };
}
