import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

function publish(ctx: RequestContext, type: string, messageId: string, payload: Record<string, unknown>): Promise<string> {
  return queue.publish(type, {
    messageId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, ...payload },
  });
}

export async function createComplaint(
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<Accepted> {
  const id = randomUUID();
  await publish(ctx, COMMANDS.sanitationComplaintCreate, id, { id, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function acknowledgeComplaint(
  ctx: RequestContext,
  id: string,
): Promise<Accepted> {
  await publish(ctx, COMMANDS.sanitationComplaintAcknowledge, randomUUID(), { id });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function assignComplaint(
  ctx: RequestContext,
  id: string,
  assignedTo: string,
): Promise<Accepted> {
  await publish(ctx, COMMANDS.sanitationComplaintAssign, randomUUID(), { id, assignedTo });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function resolveComplaint(
  ctx: RequestContext,
  id: string,
  resolution: string,
): Promise<Accepted> {
  await publish(ctx, COMMANDS.sanitationComplaintResolve, randomUUID(), { id, resolution });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function reopenComplaint(
  ctx: RequestContext,
  id: string,
  reason: string,
): Promise<Accepted> {
  await publish(ctx, COMMANDS.sanitationComplaintReopen, randomUUID(), { id, reason });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createFieldAction(
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<Accepted> {
  const id = randomUUID();
  await publish(ctx, COMMANDS.sanitationFieldActionCreate, id, { id, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
