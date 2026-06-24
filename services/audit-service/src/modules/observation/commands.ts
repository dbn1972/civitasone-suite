import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateObservationBody, DraftParaBody, ComplianceReplyBody, ReviewReplyBody, CloseObservationBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createObservation(ctx: RequestContext, body: CreateObservationBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.observationCreate, {
    messageId: id, type: COMMANDS.observationCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function draftPara(ctx: RequestContext, observationId: string, body: DraftParaBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.paraDraft, {
    messageId: id, type: COMMANDS.paraDraft,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, observationId, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * AU-01: Auditee submits a compliance reply to an observation.
 * Transitions observation status → "replied".
 */
export async function submitComplianceReply(ctx: RequestContext, observationId: string, body: ComplianceReplyBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.observationReply, {
    messageId: id, type: COMMANDS.observationReply,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, observationId, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * AU-01: Auditor reviews the compliance reply — accepts (→ "compliance_pending" or "closed") or rejects (→ "open").
 * Only audit_admin / super_admin can accept; rejection returns to auditee.
 */
export async function reviewComplianceReply(ctx: RequestContext, observationId: string, body: ReviewReplyBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.observationReview, {
    messageId: id, type: COMMANDS.observationReview,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, observationId, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * P1-6: close or partially-close an observation.
 * mode "full" → "closed"; mode "partial" → "partially_closed".
 */
export async function closeObservation(ctx: RequestContext, observationId: string, body: CloseObservationBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.observationClose, {
    messageId: id, type: COMMANDS.observationClose,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, observationId, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
