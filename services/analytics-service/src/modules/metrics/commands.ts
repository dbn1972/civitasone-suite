/** saved metrics command handler (WRITE PATH). */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, METRIC_RESOURCE } from "../../topics.js";
import type { SaveMetricBody } from "./validators.js";
import type { SavedMetricView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function saveMetric(ctx: RequestContext, body: SaveMetricBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: SavedMetricView = {
    id,
    tenantId: ctx.tenantId,
    name: body.name,
    metricKey: body.metricKey,
    spec: body.spec as unknown as Record<string, unknown>,
    version: 1,
  };
  await cache.put(cache.makeKey(ctx.tenantId, METRIC_RESOURCE, id), projected);
  await queue.publish(COMMANDS.saveMetric, {
    messageId: id,
    type: COMMANDS.saveMetric,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...projected },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
