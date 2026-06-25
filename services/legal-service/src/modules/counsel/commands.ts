import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { AssignBriefBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function assignBrief(ctx: RequestContext, body: AssignBriefBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.counselBriefAssign, {
    messageId: id, type: COMMANDS.counselBriefAssign,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.put(cache.makeKey(ctx.tenantId, "counsel_brief", id), { id, ...body, status: "assigned" });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
