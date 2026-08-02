import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function attachEvidence(
  ctx: RequestContext,
  milestoneId: string,
  body: { fileName: string; fileUrl: string; fileType: string; notes?: string | undefined },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.evidenceAttach, {
    messageId: id,
    type: COMMANDS.evidenceAttach,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, milestoneId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
