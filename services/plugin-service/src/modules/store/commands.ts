import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function storePut(
  ctx: RequestContext,
  pluginId: string,
  key: string,
  value: unknown,
  sizeBytes: number,
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.storePut, {
    messageId: id,
    type: COMMANDS.storePut,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, pluginId, key, value, sizeBytes },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function storeDelete(
  ctx: RequestContext,
  pluginId: string,
  key: string,
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.storeDelete, {
    messageId: id,
    type: COMMANDS.storeDelete,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, pluginId, key },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
