import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface RecordBouncePayload {
  recipient: string;
  deliveryId?: string | undefined;
  channel?: string | undefined;
  smtpCode?: string | undefined;
  reason?: string | undefined;
  occurredAt?: string | undefined;
}

export async function recordBounce(ctx: RequestContext, payload: RecordBouncePayload): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.recordBounce, {
    messageId: id, type: COMMANDS.recordBounce, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function releaseSuppression(ctx: RequestContext, suppressionId: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.releaseSuppression, {
    messageId, type: COMMANDS.releaseSuppression, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: suppressionId, tenantId: ctx.tenantId },
  });
  return { id: suppressionId, status: "accepted", correlationId: ctx.correlationId };
}
