/**
 * Command handlers (WRITE PATH).
 * Rule (CLAUDE.md §6): NO Postgres writes here. Validate → publish command → prime cache
 * (read-your-writes) → return the new id. The consumer does the durable DB write.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import type { CreateTenantBody, UpdateTenantBody, SuspendTenantBody, SetIsolationBody } from "./validators.js";
import type { TenantView } from "./domain.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createTenant(ctx: RequestContext, body: CreateTenantBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: TenantView = {
    id,
    tenantId: id,
    name: body.name,
    domain: body.domain,
    edition: body.edition,
    status: "draft",
    region: body.region,
    residency: body.residency,
    isolationTier: "pool",
    settings: {},
    version: 1,
  };
  // read-your-writes: prime cache so an immediate GET is consistent
  await cache.put(cache.makeKey(id, RESOURCE, id), projected);

  await queue.publish(COMMANDS.createTenant, {
    messageId: id, // idempotency: one tenant id == one create command
    type: COMMANDS.createTenant,
    tenantId: id,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateTenant(ctx: RequestContext, id: string, body: UpdateTenantBody): Promise<Accepted> {
  await queue.publish(COMMANDS.updateTenant, {
    type: COMMANDS.updateTenant,
    tenantId: id,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, ...body },
  });
  // optimistic cache invalidation handled by consumer after DB commit
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function suspendTenant(ctx: RequestContext, id: string, body: SuspendTenantBody): Promise<Accepted> {
  await queue.publish(COMMANDS.suspendTenant, {
    type: COMMANDS.suspendTenant,
    tenantId: id,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, reason: body.reason },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Set a tenant's isolation tier (pool ↔ silo). For silo, dbDsnRef points to the
 * dedicated DB's DSN in the secrets manager. Provisioning the actual DB +
 * migrating all service schemas is orchestrated by install-service on the
 * emitted tenant.tenant.isolation_changed event.
 */
export async function setIsolation(ctx: RequestContext, id: string, body: SetIsolationBody): Promise<Accepted> {
  await queue.publish(COMMANDS.setIsolation, {
    type: COMMANDS.setIsolation,
    tenantId: id,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tier: body.tier, dbDsnRef: body.dbDsnRef ?? null, kmsKeyRef: body.kmsKeyRef ?? null },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
