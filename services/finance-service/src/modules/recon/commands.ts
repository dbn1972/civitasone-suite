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
  actorRoles: readonly string[] = [],
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
      // C30: the consumer re-applies the write-off approval rule inside its transaction and needs the actor's roles.
      actorRoles: [...actorRoles],
      ...(body.note ? { note: body.note } : {}),
    },
  });
  return { id: breakId, status: "accepted", correlationId: ctx.correlationId };
}

/** C30: set the tenant's write-off second-approval threshold (paise). Finance admin only (route); audited by the consumer. */
export async function setWriteoffPolicyCmd(ctx: RequestContext, thresholdMinor: bigint): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.reconWriteoffPolicySet, {
    messageId: id,
    type: COMMANDS.reconWriteoffPolicySet,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    // paise cross the queue as a base-10 string (JSON has no bigint)
    payload: { tenantId: ctx.tenantId, thresholdMinor: thresholdMinor.toString() },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
