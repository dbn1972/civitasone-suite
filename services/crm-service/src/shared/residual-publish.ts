import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "./infra.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function publishCrmCommand(
  ctx: RequestContext,
  type: string,
  id: string,
  payload: Record<string, unknown>,
): Promise<Accepted> {
  await queue.publish(type, {
    messageId: randomUUID(),
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...payload, id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
