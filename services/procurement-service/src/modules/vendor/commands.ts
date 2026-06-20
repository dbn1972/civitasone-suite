import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateVendorBody, EmpanelBody, BlacklistBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createVendor(ctx: RequestContext, body: CreateVendorBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.vendorCreate, {
    messageId: id, type: COMMANDS.vendorCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function empanelVendor(ctx: RequestContext, id: string, body: EmpanelBody): Promise<Accepted> {
  await queue.publish(COMMANDS.vendorEmpanel, {
    type: COMMANDS.vendorEmpanel,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "vendor", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function blacklistVendor(ctx: RequestContext, id: string, body: BlacklistBody): Promise<Accepted> {
  await queue.publish(COMMANDS.vendorBlacklist, {
    type: COMMANDS.vendorBlacklist,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "vendor", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
