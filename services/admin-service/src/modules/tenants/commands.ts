import { idempotentId } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { commandMessageId } from "../../shared/idempotency.js";
import { COMMANDS, RESOURCE_TENANT } from "../../topics.js";
import type { CreateTenantBody, EditionChangeBody, SuspendBody } from "./validators.js";
import type { TenantView } from "./domain.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createTenant(ctx: RequestContext, body: CreateTenantBody): Promise<Accepted> {
  // P1-1: derive a deterministic id from the idempotency key so a retried
  // POST /tenants dedupes (same id -> same cache key, markProcessed dedupes the
  // consumer insert) instead of provisioning a second tenant.
  const id = idempotentId(ctx);
  const projected: TenantView = {
    id, tenantId: id, name: body.name, domain: body.domain, edition: body.edition,
    status: "draft", region: body.region, residency: body.residency, settings: {}, version: 1,
  };
  await cache.put(cache.makeKey(id, RESOURCE_TENANT, id), projected);
  await queue.publish(COMMANDS.tenantCreate, {
    messageId: id, type: COMMANDS.tenantCreate, tenantId: id,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: projected,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function changeEdition(ctx: RequestContext, id: string, body: EditionChangeBody): Promise<Accepted> {
  // P0-1: deterministic messageId so a double-submit of the edition change
  // dedupes at the consumer instead of applying twice.
  const messageId = commandMessageId(ctx, `tenant:${id}`, `edition_change:${body.edition}`);
  await queue.publish(COMMANDS.tenantEditionChange, {
    messageId, type: COMMANDS.tenantEditionChange, tenantId: id,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, edition: body.edition },
  });
  await cache.invalidate(cache.makeKey(id, RESOURCE_TENANT, id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function suspendTenant(ctx: RequestContext, id: string, body: SuspendBody): Promise<Accepted> {
  // P0-1: deterministic messageId so a double-submit suspends once.
  const messageId = commandMessageId(ctx, `tenant:${id}`, "suspend");
  await queue.publish(COMMANDS.tenantSuspend, {
    messageId, type: COMMANDS.tenantSuspend, tenantId: id,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, reason: body.reason },
  });
  await cache.invalidate(cache.makeKey(id, RESOURCE_TENANT, id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function reactivateTenant(ctx: RequestContext, id: string): Promise<Accepted> {
  // P0-1: deterministic messageId so a double-submit reactivates once.
  const messageId = commandMessageId(ctx, `tenant:${id}`, "reactivate");
  await queue.publish(COMMANDS.tenantReactivate, {
    messageId, type: COMMANDS.tenantReactivate, tenantId: id,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id },
  });
  await cache.invalidate(cache.makeKey(id, RESOURCE_TENANT, id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
