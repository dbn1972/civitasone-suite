import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function batchIvrHits(
  ctx: RequestContext,
  callId: string,
  rows: Array<Record<string, unknown>>,
  meta: { inserted: number; totalHits: number },
): Promise<Accepted & { callId: string; inserted: number; totalHits: number }> {
  const id = randomUUID();
  await queue.publish(COMMANDS.batchIvrHits, {
    messageId: id,
    type: COMMANDS.batchIvrHits,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, callId, rows },
  });
  return {
    id,
    status: "accepted",
    correlationId: ctx.correlationId,
    callId,
    inserted: meta.inserted,
    totalHits: meta.totalHits,
  };
}
