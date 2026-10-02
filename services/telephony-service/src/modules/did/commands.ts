/** did command handlers (WRITE PATH). */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, DID_RESOURCE, DID_NUMBER_CACHE_PREFIX } from "../../topics.js";
import { normalizeNumber } from "./domain.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import type { CreateDidMappingBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createDidMapping(ctx: RequestContext, body: CreateDidMappingBody): Promise<Accepted> {
  // A DID number can have at most one ACTIVE owner across ALL tenants
  // (migration 0020's partial unique index). Reject up front with a generic
  // 409 instead of accepting a command the consumer can only dead-letter.
  // findMappingsForNumber goes through the cross-tenant resolver, so this
  // also sees other tenants' rows; the message never says which tenant
  // holds the number. The consumer's unique-violation handling covers the
  // race between this check and the insert.
  if (body.active) {
    const holders = await repo.findMappingsForNumber(normalizeNumber(body.didNumber));
    if (holders.length > 0) {
      throw new HttpError(409, "DID_NUMBER_ASSIGNED", "number already assigned");
    }
  }
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
