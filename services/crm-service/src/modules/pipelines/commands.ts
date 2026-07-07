import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreatePipelineBody, UpdatePipelineBody } from "./validators.js";
import type { PipelineView } from "./schema.js";

const RESOURCE = "pipeline";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createPipeline(ctx: RequestContext, body: CreatePipelineBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: PipelineView = {
    id,
    tenantId: ctx.tenantId,
    name: body.name,
    stages: body.stages,
    status: "active",
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);
  await queue.publish(COMMANDS.createPipeline, {
    messageId: id,
    type: COMMANDS.createPipeline,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updatePipeline(ctx: RequestContext, id: string, body: UpdatePipelineBody): Promise<Accepted> {
  const msgId = randomUUID();
  await queue.publish(COMMANDS.updatePipeline, {
    messageId: msgId,
    type: COMMANDS.updatePipeline,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, id));
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deletePipeline(ctx: RequestContext, id: string): Promise<Accepted> {
  const msgId = randomUUID();
  await queue.publish(COMMANDS.deletePipeline, {
    messageId: msgId,
    type: COMMANDS.deletePipeline,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, id));
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
