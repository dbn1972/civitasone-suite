import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreatePlanBody, CreatePlanItemBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createPlan(ctx: RequestContext, body: CreatePlanBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.planCreate, {
    messageId: id, type: COMMANDS.planCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.put(cache.makeKey(ctx.tenantId, "plan", id), { id, ...body, status: "draft" });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createPlanItem(ctx: RequestContext, planId: string, body: CreatePlanItemBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.planItemCreate, {
    messageId: id, type: COMMANDS.planItemCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, planId, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function startPlan(ctx: RequestContext, planId: string): Promise<Accepted> {
  await queue.publish(COMMANDS.planStart, {
    type: COMMANDS.planStart,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { planId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "plan", planId));
  return { id: planId, status: "accepted", correlationId: ctx.correlationId };
}
