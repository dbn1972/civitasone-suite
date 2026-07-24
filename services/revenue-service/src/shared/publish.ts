import { randomUUID } from "node:crypto";
import { queue } from "./infra.js";
import type { RequestContext } from "./context.js";

export async function publishCommand(
  topic: string,
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<{ messageId: string }> {
  const messageId = randomUUID();
  await queue.publish(topic, {
    messageId,
    type: topic,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  });
  return { messageId };
}
