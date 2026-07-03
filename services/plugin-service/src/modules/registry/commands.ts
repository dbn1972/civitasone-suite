import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { InstallPluginBody, ConfigurePluginBody } from "./validators.js";
import type { PluginView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

const RESOURCE = "plugin";

export async function pluginInstall(ctx: RequestContext, body: InstallPluginBody): Promise<Accepted> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const projected: PluginView = {
    id,
    tenantId: ctx.tenantId,
    manifestJson: body.manifestJson,
    state: "installed",
    installedAt: now,
    enabledAt: null,
    disabledAt: null,
    config: body.config ?? null,
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);
  await queue.publish(COMMANDS.pluginInstall, {
    messageId: id,
    type: COMMANDS.pluginInstall,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function pluginEnable(ctx: RequestContext, pluginId: string): Promise<Accepted> {
  const msgId = randomUUID();
  await queue.publish(COMMANDS.pluginEnable, {
    messageId: msgId,
    type: COMMANDS.pluginEnable,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { pluginId, tenantId: ctx.tenantId },
  });
  return { id: pluginId, status: "accepted", correlationId: ctx.correlationId };
}

export async function pluginDisable(ctx: RequestContext, pluginId: string): Promise<Accepted> {
  const msgId = randomUUID();
  await queue.publish(COMMANDS.pluginDisable, {
    messageId: msgId,
    type: COMMANDS.pluginDisable,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { pluginId, tenantId: ctx.tenantId },
  });
  return { id: pluginId, status: "accepted", correlationId: ctx.correlationId };
}

export async function pluginUninstall(ctx: RequestContext, pluginId: string): Promise<Accepted> {
  const msgId = randomUUID();
  await queue.publish(COMMANDS.pluginUninstall, {
    messageId: msgId,
    type: COMMANDS.pluginUninstall,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { pluginId, tenantId: ctx.tenantId },
  });
  return { id: pluginId, status: "accepted", correlationId: ctx.correlationId };
}

export async function pluginConfigure(ctx: RequestContext, pluginId: string, body: ConfigurePluginBody): Promise<Accepted> {
  const msgId = randomUUID();
  await queue.publish(COMMANDS.pluginConfigure, {
    messageId: msgId,
    type: COMMANDS.pluginConfigure,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { pluginId, tenantId: ctx.tenantId, config: body.config },
  });
  return { id: pluginId, status: "accepted", correlationId: ctx.correlationId };
}
