import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, INSTANCE_RESOURCE } from "../../topics.js";
import type { CreateInstanceBody } from "./validators.js";
import type { InstanceView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export type CreateInstancePayload = InstanceView & {
  initialTaskName: string;
  definitionCode?: string;
  refType?: string;
  refId?: string;
};

export async function createInstance(ctx: RequestContext, body: CreateInstanceBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: CreateInstancePayload = {
    id,
    tenantId: ctx.tenantId,
    name: body.name,
    status: "active",
    version: 1,
    initialTaskName: "Review",
  };

  await cache.put(cache.makeKey(ctx.tenantId, INSTANCE_RESOURCE, id), projected);
  await queue.publish(COMMANDS.createInstance, {
    messageId: id,
    type: COMMANDS.createInstance,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}
