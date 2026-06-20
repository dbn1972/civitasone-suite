import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE_TENANT } from "../../topics.js";
import type { CreateTenantBody, EditionChangeBody, SuspendBody } from "./validators.js";
import type { TenantView } from "./domain.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createTenant(ctx: RequestContext, body: CreateTenantBody): Promise<Accepted> {
  const id = randomUUID();
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
  await queue.publish(COMMANDS.tenantEditionChange, {
    type: COMMANDS.tenantEditionChange, tenantId: id,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, edition: body.edition },
  });
  await cache.invalidate(cache.makeKey(id, RESOURCE_TENANT, id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function suspendTenant(ctx: RequestContext, id: string, body: SuspendBody): Promise<Accepted> {
  await queue.publish(COMMANDS.tenantSuspend, {
    type: COMMANDS.tenantSuspend, tenantId: id,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, reason: body.reason },
  });
  await cache.invalidate(cache.makeKey(id, RESOURCE_TENANT, id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function reactivateTenant(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.tenantReactivate, {
    type: COMMANDS.tenantReactivate, tenantId: id,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id },
  });
  await cache.invalidate(cache.makeKey(id, RESOURCE_TENANT, id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
