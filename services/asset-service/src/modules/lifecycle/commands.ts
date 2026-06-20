import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { TransferBody, DisposeBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function transferAsset(ctx: RequestContext, assetId: string, body: TransferBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.assetTransfer, {
    messageId: id, type: COMMANDS.assetTransfer,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, assetId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "asset", assetId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function disposeAsset(ctx: RequestContext, assetId: string, body: DisposeBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.assetDispose, {
    messageId: id, type: COMMANDS.assetDispose,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, assetId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "asset", assetId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
