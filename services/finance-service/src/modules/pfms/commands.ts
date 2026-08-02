import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function signBatch(
  ctx: RequestContext,
  batchId: string,
  body: { certificateRef: string; signaturePayload: string },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.pfmsBatchSign, {
    messageId: id,
    type: COMMANDS.pfmsBatchSign,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id: batchId, tenantId: ctx.tenantId, ...body },
  });
  return { id: batchId, status: "accepted", correlationId: ctx.correlationId };
}
