import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

const RESOURCE = "activity";
import type { CreateActivityBody } from "./validators.js";
import type { ActivityView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createActivity(ctx: RequestContext, body: CreateActivityBody): Promise<Accepted> {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const projected: ActivityView = {
    id,
    tenantId: ctx.tenantId,
    actorName: body.actorName,
    text: body.text,
    createdAt,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);
  await queue.publish(COMMANDS.createActivity, {
    messageId: id,
    type: COMMANDS.createActivity,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}
