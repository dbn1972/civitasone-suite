/**
 * Service Catalogue (SVC-129) — pre-command validation and payload preparation.
 *
 * Routes perform read-only validation here, then publish via commands.ts.
 * The consumer applies writes atomically (raiseRequest preserves ticket+request).
 */
import type { RequestContext } from "@civitasone/types";
import { HttpError } from "../../shared/context.js";
import * as ticketRepo from "../tickets/repo.js";
import { resolvePolicy } from "../sla/domain.js";
import * as repo from "./repo.js";
import {
  validateFormData,
  initialRequestState,
  stateAfterApproval,
  isDistinctChecker,
  canAdvanceStage,
  canFulfil,
  nextStage,
  resolveSlaTargets,
  type FormField,
  type FulfilmentStage,
} from "./domain.js";
import type { OfferingRow } from "./schema.js";
import type { RaiseRequestBody, ApprovalBody, AdvanceStageBody, FulfilRequestBody } from "./validators.js";

async function resolveOfferingSla(
  offering: OfferingRow,
  priority: string,
): Promise<{ policyId: string | null; deadlines: { responseDeadline: Date; resolutionDeadline: Date } | null }> {
  const policies = await ticketRepo.getEffectivePolicies(offering.tenantId);
  const policy = resolvePolicy(policies, priority, offering.category ?? null);
  if (!policy) return { policyId: null, deadlines: null };
  const deadlines = resolveSlaTargets(new Date(), policy);
  const policyId = policy.id.startsWith("default-") ? null : policy.id;
  return { policyId, deadlines };
}

export async function prepareRaiseRequest(
  ctx: RequestContext,
  offeringId: string,
  body: RaiseRequestBody,
): Promise<Record<string, unknown>> {
  const offering = await repo.findOffering(offeringId, ctx.tenantId);
  if (!offering) throw new HttpError(404, "NOT_FOUND", "catalogue offering not found");
  if (offering.status !== "active") throw new HttpError(409, "OFFERING_RETIRED", "offering is retired");

  const formData = (body.formData ?? {}) as Record<string, unknown>;
  const formErrors = validateFormData(offering.requestFormSchema as FormField[], formData);
  if (formErrors.length > 0) {
    throw new HttpError(422, "INVALID_FORM_DATA", formErrors.join("; "));
  }

  const priority = body.priority ?? offering.defaultPriority ?? "Medium";
  const { policyId, deadlines } = await resolveOfferingSla(offering, priority);
  const stages = offering.fulfilmentStages as FulfilmentStage[];
  const initial = initialRequestState(offering.approvalRequired, stages);

  return {
    offeringId,
    offeringName: offering.name,
    formData,
    priority,
    initialStatus: initial.status,
    initialStage: initial.stage,
    approvalRequired: offering.approvalRequired,
    slaPolicyId: policyId,
    responseDeadline: deadlines?.responseDeadline?.toISOString() ?? null,
    resolutionDeadline: deadlines?.resolutionDeadline?.toISOString() ?? null,
  };
}

export async function prepareApproval(
  ctx: RequestContext,
  requestId: string,
  body: ApprovalBody,
): Promise<Record<string, unknown>> {
  const request = await repo.findRequest(requestId, ctx.tenantId);
  if (!request) throw new HttpError(404, "NOT_FOUND", "service request not found");
  if (request.status !== "pending_approval") {
    throw new HttpError(409, "NOT_PENDING_APPROVAL", `request is '${request.status}', not pending approval`);
  }
  if (!isDistinctChecker(request.requestedBy, ctx.actorId)) {
    throw new HttpError(403, "MAKER_CHECKER_VIOLATION", "approver must differ from the requester (maker-checker)");
  }

  const offering = await repo.findOffering(request.offeringId, ctx.tenantId);
  const stages = (offering?.fulfilmentStages ?? []) as FulfilmentStage[];
  const next = stateAfterApproval(body.decision, stages);

  return {
    decision: body.decision,
    comment: body.comment ?? null,
    nextStatus: next.status,
    nextStage: next.stage,
    ticketId: request.ticketId,
  };
}

export async function prepareAdvanceStage(
  ctx: RequestContext,
  requestId: string,
  body: AdvanceStageBody,
): Promise<Record<string, unknown>> {
  const request = await repo.findRequest(requestId, ctx.tenantId);
  if (!request) throw new HttpError(404, "NOT_FOUND", "service request not found");
  if (request.status !== "in_fulfilment" && request.status !== "pending_fulfilment") {
    throw new HttpError(409, "NOT_IN_FULFILMENT", `request is '${request.status}', not in fulfilment`);
  }

  const offering = await repo.findOffering(request.offeringId, ctx.tenantId);
  const stages = (offering?.fulfilmentStages ?? []) as FulfilmentStage[];
  const from = request.currentStage;
  if (!from) throw new HttpError(422, "NO_CURRENT_STAGE", "request has no current stage to advance from");
  if (!canAdvanceStage(stages, from, body.toStage)) {
    const expected = nextStage(stages, from);
    throw new HttpError(
      422,
      "INVALID_STAGE_TRANSITION",
      `cannot advance from '${from}' to '${body.toStage}'` + (expected ? `; next stage is '${expected.key}'` : ""),
    );
  }

  return {
    fromStage: from,
    toStage: body.toStage,
    ticketId: request.ticketId,
    note: body.note ?? null,
  };
}

export async function prepareFulfilRequest(
  ctx: RequestContext,
  requestId: string,
  body: FulfilRequestBody,
): Promise<Record<string, unknown>> {
  const request = await repo.findRequest(requestId, ctx.tenantId);
  if (!request) throw new HttpError(404, "NOT_FOUND", "service request not found");
  if (!["in_fulfilment", "pending_fulfilment", "approved"].includes(request.status)) {
    throw new HttpError(409, "NOT_FULFILLABLE", `request is '${request.status}' and cannot be fulfilled`);
  }

  const offering = await repo.findOffering(request.offeringId, ctx.tenantId);
  const stages = (offering?.fulfilmentStages ?? []) as FulfilmentStage[];
  if (!canFulfil(stages, request.currentStage)) {
    throw new HttpError(422, "STAGE_NOT_TERMINAL", "request has not reached its terminal fulfilment stage");
  }

  return {
    ticketId: request.ticketId,
    offeringId: request.offeringId,
    fromStage: request.currentStage,
    note: body.note ?? null,
  };
}
