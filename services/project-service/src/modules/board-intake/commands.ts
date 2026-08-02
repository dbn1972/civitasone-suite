import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function acceptIntake(
  ctx: RequestContext, id: string, note?: string,
): Promise<Accepted> {
  await queue.publish(COMMANDS.boardIntakeAccept, {
    messageId: randomUUID(),
    type: COMMANDS.boardIntakeAccept,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, note: note ?? null },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function rejectIntake(
  ctx: RequestContext, id: string, note: string,
): Promise<Accepted> {
  await queue.publish(COMMANDS.boardIntakeReject, {
    messageId: randomUUID(),
    type: COMMANDS.boardIntakeReject,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, note },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
