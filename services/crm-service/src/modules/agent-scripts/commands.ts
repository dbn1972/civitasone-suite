import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { commandId } from "../../shared/idempotency.js";
import { COMMANDS } from "../../topics.js";
import type { CreateAgentScriptBody, UpdateAgentScriptBody } from "./validators.js";
import type { AgentScriptView } from "./schema.js";

const RESOURCE = "agent_script";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createAgentScript(ctx: RequestContext, body: CreateAgentScriptBody): Promise<Accepted> {
  const id = commandId(ctx, COMMANDS.createAgentScript);
  const nowIso = new Date().toISOString();
  const projected: AgentScriptView = {
    id,
    tenantId: ctx.tenantId,
    productCode: body.productCode,
    language: body.language,
    scriptKey: body.scriptKey,
    title: body.title,
    body: body.body,
    versionNumber: body.versionNumber,
    status: "draft",
    tags: body.tags,
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: ctx.actorId,
    updatedBy: ctx.actorId,
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);
  await queue.publish(COMMANDS.createAgentScript, {
    messageId: id, type: COMMANDS.createAgentScript,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateAgentScript(ctx: RequestContext, id: string, body: UpdateAgentScriptBody): Promise<Accepted> {
  const msgId = commandId(ctx, `${COMMANDS.updateAgentScript}:${id}`);
  await queue.publish(COMMANDS.updateAgentScript, {
    messageId: msgId, type: COMMANDS.updateAgentScript,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, id));
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function publishAgentScript(ctx: RequestContext, id: string): Promise<Accepted> {
  const msgId = commandId(ctx, `${COMMANDS.publishAgentScript}:${id}`);
  await queue.publish(COMMANDS.publishAgentScript, {
    messageId: msgId, type: COMMANDS.publishAgentScript,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, id));
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deprecateAgentScript(ctx: RequestContext, id: string): Promise<Accepted> {
  const msgId = commandId(ctx, `${COMMANDS.deprecateAgentScript}:${id}`);
  await queue.publish(COMMANDS.deprecateAgentScript, {
    messageId: msgId, type: COMMANDS.deprecateAgentScript,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, id));
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
