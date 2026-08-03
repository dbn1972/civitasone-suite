import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "./infra.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function publishAdminCommand(
  ctx: RequestContext,
  type: string,
  id: string,
  payload: Record<string, unknown>,
): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(type, {
    messageId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...payload, id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
