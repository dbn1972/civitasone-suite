import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateBindingBody, BreakglassBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createBinding(ctx: RequestContext, body: CreateBindingBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.createBinding, {
    messageId: id, type: COMMANDS.createBinding, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, userId: body.userId, roleId: body.roleId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function revokeBinding(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.revokeBinding, {
    type: COMMANDS.revokeBinding, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function requestBreakglass(ctx: RequestContext, body: BreakglassBody): Promise<Accepted> {
  const id = randomUUID();
  const grantedUntil = new Date(Date.now() + body.durationMinutes * 60 * 1000).toISOString();
  await queue.publish(COMMANDS.requestBreakglass, {
    messageId: id, type: COMMANDS.requestBreakglass, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, requesterId: ctx.actorId, reason: body.reason, scope: body.scope, grantedUntil },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
