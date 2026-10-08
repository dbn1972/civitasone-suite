import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { PhysicalProgressBody, FinancialProgressBody, DprBody, DprTransitionBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function recordPhysicalProgress(ctx: RequestContext, projectId: string, body: PhysicalProgressBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.physicalProgressRecord, {
    messageId: id, type: COMMANDS.physicalProgressRecord,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, projectId, reportedBy: ctx.actorId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "progress", projectId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function recordFinancialProgress(ctx: RequestContext, projectId: string, body: FinancialProgressBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.financialProgressRecord, {
    messageId: id, type: COMMANDS.financialProgressRecord,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, projectId, reportedBy: ctx.actorId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "progress", projectId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function submitDpr(ctx: RequestContext, projectId: string, body: DprBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.dprSubmit, {
    messageId: id, type: COMMANDS.dprSubmit,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, projectId, submittedBy: ctx.actorId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "progress", projectId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * GAP-PROJECTS-DPR-TRACKING-01: enqueue a DPR review transition. The route has
 * already validated the action and (for a return) that a reason is present; the
 * consumer re-checks the source status + optimistic version and writes the
 * audit event in the same transaction, so this stays a thin command.
 */
export async function transitionDpr(
  ctx: RequestContext, projectId: string, dprId: string, body: DprTransitionBody,
): Promise<Accepted> {
  await queue.publish(COMMANDS.dprTransition, {
    messageId: randomUUID(), type: COMMANDS.dprTransition,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { dprId, tenantId: ctx.tenantId, projectId, action: body.action, reason: body.reason ?? null },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "progress", projectId));
  return { id: dprId, status: "accepted", correlationId: ctx.correlationId };
}
