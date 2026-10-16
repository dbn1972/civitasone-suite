import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateVendorBody, EmpanelBody, BlacklistBody, SuspendBody } from "./validators.js";

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
    messageId: randomUUID(),
    type: COMMANDS.vendorEmpanel,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "vendor", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function blacklistVendor(ctx: RequestContext, id: string, body: BlacklistBody): Promise<Accepted> {
  await queue.publish(COMMANDS.vendorBlacklist, {
    messageId: randomUUID(),
    type: COMMANDS.vendorBlacklist,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "vendor", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * GAP-PROCUREMENT-VENDORS-DETAIL-02: suspend a vendor's empanelment (the
 * `suspended` state already exists on procurement_empanelment.status). A
 * suspended vendor fails the PO empanelment gate (domain.isEmpanelmentLapsed
 * treats any non-active row as lapsed) until it is empanelled again.
 */
export async function suspendVendor(ctx: RequestContext, id: string, body: SuspendBody): Promise<Accepted> {
  await queue.publish(COMMANDS.vendorSuspend, {
    messageId: randomUUID(),
    type: COMMANDS.vendorSuspend,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "vendor", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
