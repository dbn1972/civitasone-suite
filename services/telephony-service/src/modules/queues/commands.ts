/** queues command handlers (WRITE PATH). */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, QUEUE_RESOURCE } from "../../topics.js";
import type { CreateQueueBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createQueue(ctx: RequestContext, body: CreateQueueBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.createQueue, {
    messageId: id,
    type: COMMANDS.createQueue,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      name: body.name,
      description: body.description ?? null,
      slaAnswerSeconds: body.slaAnswerSeconds,
    },
  });
  await cache.invalidateResource(ctx.tenantId, QUEUE_RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
