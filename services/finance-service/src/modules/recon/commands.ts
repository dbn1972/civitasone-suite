import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function startReconRun(
  ctx: RequestContext,
  body: { provider: string; params?: Record<string, unknown> | undefined },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.reconRun, {
    messageId: id,
    type: COMMANDS.reconRun,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      provider: body.provider,
      params: body.params ?? {},
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function applyExceptionActionCmd(
  ctx: RequestContext,
  breakId: string,
  body: { action: string; note?: string | undefined },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.reconExceptionAction, {
    messageId: id,
    type: COMMANDS.reconExceptionAction,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id: breakId,
      tenantId: ctx.tenantId,
      action: body.action,
      ...(body.note ? { note: body.note } : {}),
    },
  });
  return { id: breakId, status: "accepted", correlationId: ctx.correlationId };
}
