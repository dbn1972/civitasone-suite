import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, INSTANCE_RESOURCE } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import type { CreateInstanceBody } from "./validators.js";
import type { InstanceView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export type LifecyclePayload = {
  id: string;
  tenantId: string;
  fromStatus: string;
  toStatus: string;
  reason?: string;
};

/**
 * P0-2 — instance lifecycle (cancel / suspend / resume). We validate the
 * transition synchronously (existence, tenant scope, legal status change) so
 * the caller gets an immediate 404/409, then publish a command; the consumer
 * applies the status change and appends a transition_history row under a lock.
 */
async function publishLifecycle(
  ctx: RequestContext,
  instanceId: string,
  command: string,
  toStatus: string,
  allowedFrom: string[],
  reason: string | undefined,
): Promise<Accepted> {
  const instance = await repo.findById(instanceId, ctx.tenantId);
  if (!instance) throw new HttpError(404, "NOT_FOUND", "instance not found");
  if (instance.status === "completed" || instance.status === "cancelled") {
    throw new HttpError(409, "INSTANCE_TERMINAL", `instance is ${instance.status}; no further transitions allowed`);
  }
  if (!allowedFrom.includes(instance.status)) {
    throw new HttpError(409, "INVALID_TRANSITION", `cannot ${toStatus === "cancelled" ? "cancel" : toStatus === "suspended" ? "suspend" : "resume"} an instance in status '${instance.status}'`);
  }

  const payload: LifecyclePayload = {
    id: instanceId,
    tenantId: ctx.tenantId,
    fromStatus: instance.status,
    toStatus,
    ...(reason !== undefined ? { reason } : {}),
  };
  await queue.publish(command, {
    messageId: randomUUID(),
    type: command,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  });
  return { id: instanceId, status: "accepted", correlationId: ctx.correlationId };
}

export function cancelInstance(ctx: RequestContext, id: string, reason?: string): Promise<Accepted> {
  return publishLifecycle(ctx, id, COMMANDS.cancelInstance, "cancelled", ["active", "suspended"], reason);
}

export function suspendInstance(ctx: RequestContext, id: string, reason?: string): Promise<Accepted> {
  return publishLifecycle(ctx, id, COMMANDS.suspendInstance, "suspended", ["active"], reason);
}

export function resumeInstance(ctx: RequestContext, id: string, reason?: string): Promise<Accepted> {
  return publishLifecycle(ctx, id, COMMANDS.resumeInstance, "active", ["suspended"], reason);
}

export type CreateInstancePayload = InstanceView & {
  initialTaskName: string;
  definitionCode?: string;
  refType?: string;
  refId?: string;
  context?: Record<string, unknown>;
};

export async function createInstance(ctx: RequestContext, body: CreateInstanceBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: CreateInstancePayload = {
    id,
    tenantId: ctx.tenantId,
    name: body.name,
    status: "active",
    version: 1,
    initialTaskName: "Review",
    ...(body.definitionCode !== undefined ? { definitionCode: body.definitionCode } : {}),
    ...(body.refType !== undefined ? { refType: body.refType } : {}),
    ...(body.refId !== undefined ? { refId: body.refId } : {}),
    ...(body.context !== undefined ? { context: body.context } : {}),
  };

  await cache.put(cache.makeKey(ctx.tenantId, INSTANCE_RESOURCE, id), projected);
  await queue.publish(COMMANDS.createInstance, {
    messageId: id,
    type: COMMANDS.createInstance,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}
