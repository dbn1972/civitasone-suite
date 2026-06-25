import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { RecordFilingBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function recordFiling(ctx: RequestContext, body: RecordFilingBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.filingRecord, {
    messageId: id, type: COMMANDS.filingRecord,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.put(cache.makeKey(ctx.tenantId, "filing", id), { id, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
