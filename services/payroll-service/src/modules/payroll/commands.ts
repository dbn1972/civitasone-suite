import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateStructureBody, CreateRunBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createStructure(ctx: RequestContext, body: CreateStructureBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.structureCreate, {
    messageId: id, type: COMMANDS.structureCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createRun(ctx: RequestContext, body: CreateRunBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.runCreate, {
    messageId: id, type: COMMANDS.runCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body, status: "draft" },
  });
  await cache.put(cache.makeKey(ctx.tenantId, "payroll_run", id), { id, ...body, status: "draft" });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function approveRun(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.runApprove, {
    type: COMMANDS.runApprove,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, approvedBy: ctx.actorId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "payroll_run", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function disburseRun(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.runDisburse, {
    type: COMMANDS.runDisburse,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "payroll_run", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
