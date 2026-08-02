import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function addVendorBlacklist(
  ctx: RequestContext,
  vendorId: string,
  body: {
    reason: string;
    blacklistedFrom: string;
    blacklistedUntil?: string | undefined;
    orderRef?: string | undefined;
  },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.vendorBlacklistAdd, {
    messageId: id,
    type: COMMANDS.vendorBlacklistAdd,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, vendorId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function reinstateVendorBlacklist(ctx: RequestContext, vendorId: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.vendorBlacklistReinstate, {
    messageId: id,
    type: COMMANDS.vendorBlacklistReinstate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, vendorId },
  });
  return { id: vendorId, status: "accepted", correlationId: ctx.correlationId };
}

export async function addCentralDebarment(
  ctx: RequestContext,
  body: {
    pan: string;
    reason: string;
    blacklistedFrom: string;
    blacklistedUntil?: string | undefined;
    orderRef?: string | undefined;
  },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.vendorCentralDebar, {
    messageId: id,
    type: COMMANDS.vendorCentralDebar,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body, pan: body.pan.toUpperCase() },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
