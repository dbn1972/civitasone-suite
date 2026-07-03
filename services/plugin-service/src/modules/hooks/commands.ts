import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { RegisterHookBody } from "./validators.js";
import type { PluginHookView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

const RESOURCE = "hook";

export async function hookRegister(ctx: RequestContext, body: RegisterHookBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: PluginHookView = {
    id,
    tenantId: ctx.tenantId,
    pluginId: body.pluginId,
    eventType: body.eventType,
    handlerPath: body.handlerPath,
    active: true,
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);
  await queue.publish(COMMANDS.hookRegister, {
    messageId: id,
    type: COMMANDS.hookRegister,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function hookDeregister(ctx: RequestContext, hookId: string): Promise<Accepted> {
  const msgId = randomUUID();
  await queue.publish(COMMANDS.hookDeregister, {
    messageId: msgId,
    type: COMMANDS.hookDeregister,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { hookId, tenantId: ctx.tenantId },
  });
  return { id: hookId, status: "accepted", correlationId: ctx.correlationId };
}
