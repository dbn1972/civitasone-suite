import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateRenewalBody, UpdateRenewalBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createRenewal(ctx: RequestContext, body: CreateRenewalBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.renewalCreate, {
    messageId: id, type: COMMANDS.renewalCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateRenewal(
  ctx: RequestContext, id: string, version: number, body: UpdateRenewalBody,
): Promise<Accepted> {
  await queue.publish(COMMANDS.renewalUpdate, {
    messageId: randomUUID(), type: COMMANDS.renewalUpdate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      id, tenantId: ctx.tenantId, version,
      ...(body.advanceNoticeDays !== undefined && { advanceNoticeDays: body.advanceNoticeDays }),
      ...(body.status !== undefined && { status: body.status }),
    },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "renewal", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
