import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateObligationBody, UpdateObligationBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

/** Queue-first create. Reminder scheduling (30d/14d/7d) happens in the consumer. */
export async function createObligation(ctx: RequestContext, body: CreateObligationBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.obligationCreate, {
    messageId: id, type: COMMANDS.obligationCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateObligation(
  ctx: RequestContext, id: string, version: number, body: UpdateObligationBody,
): Promise<Accepted> {
  await queue.publish(COMMANDS.obligationUpdate, {
    messageId: randomUUID(), type: COMMANDS.obligationUpdate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      id, tenantId: ctx.tenantId, version,
      ...(body.title !== undefined && { title: body.title }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.dueDate !== undefined && { dueDate: body.dueDate }),
      ...(body.ownerId !== undefined && { ownerId: body.ownerId }),
      ...(body.status !== undefined && { status: body.status }),
    },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "obligation", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
