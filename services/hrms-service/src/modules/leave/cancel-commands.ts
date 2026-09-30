import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

/**
 * GAP-HR-LEAVE-HISTORY-04: `reason` is new and optional here — cancel-route.ts
 * is what actually enforces it's present for the one case that needs it
 * (reversing an approved leave); this command layer just forwards whatever
 * it was given straight through to the consumer's audit trail.
 */
export async function cancelLeave(ctx: RequestContext, id: string, reason?: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.leaveCancel, {
    messageId, type: COMMANDS.leaveCancel, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, reason: reason ?? null },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
