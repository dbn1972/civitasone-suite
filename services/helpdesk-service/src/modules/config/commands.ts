import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";

/** Publish a config-master command; messageId doubles as the idempotency key. */
export async function publishConfig(
  ctx: RequestContext,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await queue.publish(type, {
    messageId: randomUUID(),
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, ...payload },
  });
}
