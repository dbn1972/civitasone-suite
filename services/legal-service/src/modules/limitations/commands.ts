import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateLimitationBody, UpdateLimitationBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createLimitation(ctx: RequestContext, body: CreateLimitationBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.limitationCreate, {
    messageId: id,
    type: COMMANDS.limitationCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...body, id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateLimitation(ctx: RequestContext, ruleId: string, body: UpdateLimitationBody): Promise<Accepted> {
  await queue.publish(COMMANDS.limitationUpdate, {
    messageId: randomUUID(),
    type: COMMANDS.limitationUpdate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...body, id: ruleId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "limitation", ruleId));
  return { id: ruleId, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteLimitation(ctx: RequestContext, ruleId: string): Promise<Accepted> {
  await queue.publish(COMMANDS.limitationDelete, {
    messageId: randomUUID(),
    type: COMMANDS.limitationDelete,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id: ruleId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "limitation", ruleId));
  return { id: ruleId, status: "accepted", correlationId: ctx.correlationId };
}
