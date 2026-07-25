import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { assertDistinctMakerChecker, assertTransitionAllowed, DomainError } from "./domain.js";
import type {
  CreatePlanBody, AggregateFromIndentsBody, SubmitPlanBody,
  ApprovePlanBody, RejectPlanBody, LinkTenderBody,
} from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createPlan(ctx: RequestContext, body: CreatePlanBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.planCreate, {
    messageId: id, type: COMMANDS.planCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, mode: "explicit", ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function aggregatePlanFromIndents(ctx: RequestContext, body: AggregateFromIndentsBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.planCreate, {
    messageId: id, type: COMMANDS.planCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, mode: "from_indents", ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

async function loadPlanOr404(ctx: RequestContext, id: string) {
  const plan = await repo.findPlanById(id, ctx.tenantId);
  if (!plan) throw new HttpError(404, "NOT_FOUND", "plan not found");
  return plan;
}

export async function submitPlan(ctx: RequestContext, id: string, body: SubmitPlanBody): Promise<Accepted> {
  const plan = await loadPlanOr404(ctx, id);
  try {
    assertTransitionAllowed(plan.status, "pending");
  } catch (err) {
    if (err instanceof DomainError) throw new HttpError(409, err.code, err.message);
    throw err;
  }
  await queue.publish(COMMANDS.planSubmit, {
    messageId: randomUUID(), type: COMMANDS.planSubmit,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, notes: body.notes },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "plan", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function approvePlan(ctx: RequestContext, id: string, body: ApprovePlanBody): Promise<Accepted> {
  const plan = await loadPlanOr404(ctx, id);
  // Maker-checker: reject self-approval synchronously with 403.
  const maker = plan.submittedBy ?? plan.createdBy;
  try {
    assertDistinctMakerChecker(maker, ctx.actorId);
    assertTransitionAllowed(plan.status, "approved");
  } catch (err) {
    if (err instanceof DomainError) {
      const code = err.code === "SOD_VIOLATION" ? 403 : 409;
      throw new HttpError(code, err.code, err.message);
    }
    throw err;
  }
  await queue.publish(COMMANDS.planApprove, {
    messageId: randomUUID(), type: COMMANDS.planApprove,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, notes: body.notes },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "plan", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function rejectPlan(ctx: RequestContext, id: string, body: RejectPlanBody): Promise<Accepted> {
  const plan = await loadPlanOr404(ctx, id);
  try {
    assertTransitionAllowed(plan.status, "rejected");
  } catch (err) {
    if (err instanceof DomainError) throw new HttpError(409, err.code, err.message);
    throw err;
  }
  await queue.publish(COMMANDS.planReject, {
    messageId: randomUUID(), type: COMMANDS.planReject,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, reason: body.reason },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "plan", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function linkTender(ctx: RequestContext, id: string, body: LinkTenderBody): Promise<Accepted> {
  const plan = await loadPlanOr404(ctx, id);
  try {
    // Only approved plans may be linked to a tender.
    const { assertPlanApprovedForLinkage } = await import("./domain.js");
    assertPlanApprovedForLinkage(plan.status);
  } catch (err) {
    if (err instanceof DomainError) throw new HttpError(409, err.code, err.message);
    throw err;
  }
  await queue.publish(COMMANDS.planLinkTender, {
    messageId: randomUUID(), type: COMMANDS.planLinkTender,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, lineId: body.lineId, tenderId: body.tenderId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "plan", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
