import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function closePeriod(
  ctx: RequestContext,
  period: string,
  closeType: "soft_close" | "hard_close",
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.periodClose, {
    messageId: id,
    type: COMMANDS.periodClose,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, period, closeType },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function reopenPeriod(
  ctx: RequestContext,
  period: string,
  reason?: string,
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.periodReopen, {
    messageId: id,
    type: COMMANDS.periodReopen,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, period, ...(reason ? { reason } : {}) },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
