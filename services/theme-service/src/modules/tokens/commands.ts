import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import type { CreateTokenBody } from "./validators.js";
import type { TokenView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createToken(ctx: RequestContext, body: CreateTokenBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: TokenView = {
    id,
    tenantId: ctx.tenantId,
    name: body.name,
    value: body.value,
    category: body.category ?? null,
    status: "active",
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);
  await queue.publish(COMMANDS.createToken, {
    messageId: id,
    type: COMMANDS.createToken,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}
