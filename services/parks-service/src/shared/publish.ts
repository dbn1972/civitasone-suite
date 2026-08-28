import { randomUUID } from "node:crypto";
import { queue } from "./infra.js";

export interface Accepted {
  id: string;
  status: string;
  correlationId: string;
}

export interface CommandCtx {
  tenantId: string;
  actorId: string;
  correlationId: string;
}

export async function publishCommand(
  ctx: CommandCtx,
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
    payload: { id, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
