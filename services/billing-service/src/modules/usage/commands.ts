import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function recordUsage(ctx: RequestContext, tenantId: string, metricKey: string, quantity: number): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.usageRecord, {
    messageId: id, type: COMMANDS.usageRecord, tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { tenantId, metricKey, quantity },
  });
  await cache.invalidate(cache.makeKey(tenantId, "usage", tenantId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
