import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { SubmitUcBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function submitUc(ctx: RequestContext, schemeId: string, body: SubmitUcBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.ucSubmit, {
    messageId: id, type: COMMANDS.ucSubmit,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, schemeId, submittedBy: ctx.actorId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "uc", schemeId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
