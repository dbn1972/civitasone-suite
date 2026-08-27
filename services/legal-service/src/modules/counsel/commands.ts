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
  // tenantId must be in the cached shape: queries.ts's getBrief() rejects a
  // cache hit whose row.tenantId doesn't match the caller's tenant (defends
  // against a cross-tenant cache-key collision). Without it, undefined !==
  // "<real tenant id>" is true, so getBrief() nulls out this very entry on
  // the very first read — confirmed live: POST then an immediate GET
  // /v1/legal/counsel-briefs/:id returned 404 for a brief that had just been
  // created, purely because this primed value was missing the field its own
  // reader checks.
  await cache.put(cache.makeKey(ctx.tenantId, "counsel_brief", id), { id, tenantId: ctx.tenantId, ...body, status: "assigned" });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
