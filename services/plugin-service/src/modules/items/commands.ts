import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import type { CreateItemBody } from "./validators.js";
import type { ItemView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createItem(ctx: RequestContext, body: CreateItemBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: ItemView = {
    id,
    tenantId: ctx.tenantId,
    name: body.name,
    semver: body.semver,
    description: body.description ?? null,
    status: "active",
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);
  await queue.publish(COMMANDS.createItem, {
    messageId: id,
    type: COMMANDS.createItem,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}
