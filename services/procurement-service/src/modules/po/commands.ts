import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreatePoBody, GemOrderBody, DispatchBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createPo(ctx: RequestContext, body: CreatePoBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.poCreate, {
    messageId: id, type: COMMANDS.poCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function dispatchPo(ctx: RequestContext, id: string, body: DispatchBody): Promise<Accepted> {
  await queue.publish(COMMANDS.poDispatch, {
    type: COMMANDS.poDispatch,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "po", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createGemOrder(ctx: RequestContext, body: GemOrderBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.gemOrderCreate, {
    messageId: id, type: COMMANDS.gemOrderCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
