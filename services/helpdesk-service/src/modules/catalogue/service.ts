/**
 * Service Catalogue (SVC-129) — command orchestration.
 *
 * These operations are transactional and synchronous: each runs inside a single
 * db.transaction() (RLS GUC supplied by the request's tenant hook, or by
 * runWithTenant() in tests/sweeper) so the domain write + its outbox events are
 * atomic. The self-service raise path additionally inserts a linked helpdesk
 * ticket in the SAME transaction, so "raise a request → fulfilment item + ticket"
 * either both happen or neither does.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { HttpError } from "../../shared/context.js";
import { EVENTS } from "../../topics.js";
import * as ticketRepo from "../tickets/repo.js";
import { tickets } from "../tickets/schema.js";
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
import type { OfferingRow, ServiceRequestRow } from "./schema.js";
import type { RaiseRequestBody, ApprovalBody, AdvanceStageBody, FulfilRequestBody } from "./validators.js";

const AUDIT_TOPIC = "audit.event.record";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function audit(
  tx: unknown,
  ctx: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceId: string,
  outcome = "success",
): Promise<unknown> {
  return enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload: { service: "helpdesk", action, resourceType: "service_request", resourceId, outcome },
  });
}

function event(
  tx: unknown,
  ctx: { tenantId: string; actorId: string; correlationId: string },
  eventType: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: eventType,
    eventType,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload,
  });
}

/** Resolve the effective SLA policy for an offering at a given priority. */
async function resolveOfferingSla(
  offering: OfferingRow,
  priority: string,
): Promise<{ policyId: string | null; deadlines: { responseDeadline: Date; resolutionDeadline: Date } | null }> {
  const policies = await ticketRepo.getEffectivePolicies(offering.tenantId);
  const policy = resolvePolicy(policies, priority, offering.category ?? null);
  if (!policy) return { policyId: null, deadlines: null };
  const deadlines = resolveSlaTargets(new Date(), policy);
  // Only surface a real (persisted) policy id; synthetic default ids start with "default-".
  const policyId = policy.id.startsWith("default-") ? null : policy.id;
  return { policyId, deadlines };
}

export interface RaiseResult {
  requestId: string;
  ticketId: string;
  status: string;
  currentStage: string | null;
}

/**
 * Raise a request from the catalogue. Creates a fulfilment item (service_request)
 * AND a linked helpdesk ticket atomically, resolves the offering's SLA targets,
 * and routes into approval or fulfilment per the offering configuration.
 */
export async function raiseRequest(
  ctx: RequestContext,
  offeringId: string,
  body: RaiseRequestBody,
): Promise<RaiseResult> {
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

  const requestId = randomUUID();
  const ticketId = randomUUID();
  const now = new Date();

  await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as ticketRepo.Writer & repo.Writer;

    // 1. linked helpdesk ticket (source=catalogue, sourceRef=requestId)
    await ticketRepo.insert(tx as ticketRepo.Writer, {
      id: ticketId,
      tenantId: ctx.tenantId,
      subject: `${offering.name} — service request`,
      description: `Self-service catalogue request for "${offering.name}".`,
      priority,
      status: "open",
      source: "catalogue",
      sourceRef: requestId,
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
      version: 1,
    } as typeof tickets.$inferInsert);

    // 2. the fulfilment item
    await repo.insertRequest(tx as repo.Writer, {
      id: requestId,
      tenantId: ctx.tenantId,
      offeringId,
      ticketId,
      requestedBy: ctx.actorId,
      formData,
      status: initial.status,
      currentStage: initial.stage,
      slaPolicyId: policyId,
      responseDeadline: deadlines?.responseDeadline ?? null,
      resolutionDeadline: deadlines?.resolutionDeadline ?? null,
      slaStatus: "within_sla",
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
      version: 1,
    });

    // 3. opening stage event when fulfilment started immediately
    if (initial.stage) {
      await repo.insertStageEvent(tx as repo.Writer, {
        tenantId: ctx.tenantId,
        requestId,
        fromStage: null,
        toStage: initial.stage,
        actorId: ctx.actorId,
        note: "request raised",
      });
    }

    // 4. domain + integration events + audit
    await event(tx, ctx, EVENTS.requestRaised, {
      requestId,
      offeringId,
      offeringName: offering.name,
      ticketId,
      requestedBy: ctx.actorId,
      status: initial.status,
      approvalRequired: offering.approvalRequired,
    });
    await event(tx, ctx, EVENTS.ticketCreated, {
      ticketId,
      subject: `${offering.name} — service request`,
      source: "catalogue",
      sourceRef: requestId,
    });
    await audit(tx, ctx, "raise_request", requestId);
  });

  return { requestId, ticketId, status: initial.status, currentStage: initial.stage };
}

/**
 * Approve or reject a request pending approval. Enforces maker-checker: the
 * checker (actor) must differ from the maker (requester).
 */
export async function decideApproval(
  ctx: RequestContext,
  requestId: string,
  body: ApprovalBody,
): Promise<{ requestId: string; status: string; currentStage: string | null }> {
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

  await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as repo.Writer;
    await repo.insertApproval(tx, {
      tenantId: ctx.tenantId,
      requestId,
      decision: body.decision,
      decidedBy: ctx.actorId,
      comment: body.comment ?? null,
      createdBy: ctx.actorId,
    });
    await repo.updateRequest(tx, requestId, ctx.tenantId, {
      status: next.status,
      currentStage: next.stage,
      updatedBy: ctx.actorId,
    });
    if (body.decision === "approved" && next.stage) {
      await repo.insertStageEvent(tx, {
        tenantId: ctx.tenantId,
        requestId,
        fromStage: null,
        toStage: next.stage,
        actorId: ctx.actorId,
        note: "approved — fulfilment started",
      });
    }
    await event(tx, ctx, body.decision === "approved" ? EVENTS.requestApproved : EVENTS.requestRejected, {
      requestId,
      ticketId: request.ticketId,
      decidedBy: ctx.actorId,
      status: next.status,
    });
    await audit(tx, ctx, body.decision === "approved" ? "approve_request" : "reject_request", requestId);
  });

  return { requestId, status: next.status, currentStage: next.stage };
}

/** Advance a request to the next fulfilment stage (strictly forward, adjacent). */
export async function advanceStage(
  ctx: RequestContext,
  requestId: string,
  body: AdvanceStageBody,
): Promise<{ requestId: string; currentStage: string; status: string }> {
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

  await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as repo.Writer;
    await repo.updateRequest(tx, requestId, ctx.tenantId, {
      status: "in_fulfilment",
      currentStage: body.toStage,
      updatedBy: ctx.actorId,
    });
    await repo.insertStageEvent(tx, {
      tenantId: ctx.tenantId,
      requestId,
      fromStage: from,
      toStage: body.toStage,
      actorId: ctx.actorId,
      note: body.note ?? null,
    });
    await event(tx, ctx, EVENTS.requestStageAdvanced, {
      requestId,
      ticketId: request.ticketId,
      fromStage: from,
      toStage: body.toStage,
    });
    await audit(tx, ctx, "advance_stage", requestId);
  });

  return { requestId, currentStage: body.toStage, status: "in_fulfilment" };
}

/**
 * Mark a request fulfilled (closes the fulfilment item and resolves the linked
 * ticket). Only allowed once the terminal stage is reached (or when the offering
 * defines no stages).
 */
export async function fulfilRequest(
  ctx: RequestContext,
  requestId: string,
  body: FulfilRequestBody,
): Promise<{ requestId: string; status: string }> {
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

  const now = new Date();
  await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as repo.Writer & ticketRepo.Writer;
    await repo.updateRequest(tx as repo.Writer, requestId, ctx.tenantId, {
      status: "fulfilled",
      updatedBy: ctx.actorId,
    });
    await repo.insertStageEvent(tx as repo.Writer, {
      tenantId: ctx.tenantId,
      requestId,
      fromStage: request.currentStage,
      toStage: "fulfilled",
      actorId: ctx.actorId,
      note: body.note ?? "request fulfilled",
    });
    // resolve the linked ticket
    if (request.ticketId) {
      await ticketRepo.transitionStatus(
        tx as ticketRepo.Writer,
        request.ticketId,
        ctx.tenantId,
        "resolved",
        ctx.actorId,
        now,
      );
    }
    await event(tx, ctx, EVENTS.requestFulfilled, {
      requestId,
      ticketId: request.ticketId,
      offeringId: request.offeringId,
    });
    await audit(tx, ctx, "fulfil_request", requestId);
  });

  return { requestId, status: "fulfilled" };
}

export type { ServiceRequestRow };
