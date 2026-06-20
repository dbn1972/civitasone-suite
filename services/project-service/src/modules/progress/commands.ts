import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { PhysicalProgressBody, FinancialProgressBody, DprBody } from "./validators.js";

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
