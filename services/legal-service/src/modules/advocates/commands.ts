import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateAdvocateBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createAdvocate(ctx: RequestContext, body: CreateAdvocateBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.advocateCreate, {
    messageId: id, type: COMMANDS.advocateCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidateResource(ctx.tenantId, "advocates");
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
