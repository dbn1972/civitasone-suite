import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import type { ApiAction } from "./domain.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface RegisterBody {
  name: string;
  module: string;
  version: string;
  path: string;
  method: string;
  upstream?: string | undefined;
  owner?: string | undefined;
  description?: string | undefined;
  status: "draft" | "active";
}

export async function registerApi(ctx: RequestContext, body: RegisterBody): Promise<Accepted> {
  const id = randomUUID();
  const projected = {
    id,
    tenantId: ctx.tenantId,
    ...body,
    source: "manual" as const,
    status: body.status,
  };
  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);
  await queue.publish(COMMANDS.registerApi, {
    messageId: id,
    type: COMMANDS.registerApi,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function lifecycleApi(
  ctx: RequestContext,
  id: string,
  action: ApiAction,
  opts: { deprecationDate?: string | undefined; sunsetDate?: string | undefined; note?: string | undefined },
): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.lifecycleApi, {
    messageId,
    type: COMMANDS.lifecycleApi,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, action, ...opts },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function seedCatalogue(ctx: RequestContext): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.seedCatalogue, {
    messageId: id,
    type: COMMANDS.seedCatalogue,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
