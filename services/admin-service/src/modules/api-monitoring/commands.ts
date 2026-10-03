/**
 * Route -> publish command. The route never writes; the consumer is the single
 * writer. messageIds are fresh randomUUID()s so a repeated decision is never
 * de-duplicated away by a deterministic id.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export interface Accepted { id: string; status: string; correlationId: string }

export async function setRetention(ctx: RequestContext, retentionDays: number): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.apiMetricsRetentionSet, {
    messageId: randomUUID(),
    type: COMMANDS.apiMetricsRetentionSet,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, retentionDays },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
