/**
 * Command handlers (WRITE PATH) — publish command, prime cache, return accepted.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import type { CreateCallBody } from "./validators.js";
import type { CallView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createCall(ctx: RequestContext, body: CreateCallBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: CallView = {
    id,
    tenantId: ctx.tenantId,
    name: body.name,
    callerNumber: body.callerNumber ?? null,
    status: "active",
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);

  await queue.publish(COMMANDS.createCall, {
    messageId: id,
    type: COMMANDS.createCall,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}
