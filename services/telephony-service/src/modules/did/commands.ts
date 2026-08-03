/** did command handlers (WRITE PATH). */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, DID_RESOURCE, DID_NUMBER_CACHE_PREFIX } from "../../topics.js";
import { normalizeNumber } from "./domain.js";
import type { CreateDidMappingBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createDidMapping(ctx: RequestContext, body: CreateDidMappingBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.createDidMapping, {
    messageId: id,
    type: COMMANDS.createDidMapping,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      didNumber: body.didNumber,
      label: body.label ?? null,
      active: body.active,
    },
  });
  await cache.invalidate(`${DID_NUMBER_CACHE_PREFIX}${normalizeNumber(body.didNumber)}`);
  await cache.invalidateResource(ctx.tenantId, DID_RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteDidMapping(ctx: RequestContext, id: string, didNumber: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.deleteDidMapping, {
    messageId,
    type: COMMANDS.deleteDidMapping,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  await cache.invalidate(`${DID_NUMBER_CACHE_PREFIX}${normalizeNumber(didNumber)}`);
  await cache.invalidate(cache.makeKey(ctx.tenantId, DID_RESOURCE, id));
  await cache.invalidateResource(ctx.tenantId, DID_RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
