import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { ArrearDecision, ArrearPolicyBody } from "./api.js";

export type Accepted = { id: string; status: string; correlationId: string };

/**
 * A FRESH messageId per attempt. A deterministic id (arrear id + decision)
 * would mark a REFUSED attempt (e.g. the maker deciding their own arrear)
 * processed and silently drop the legitimate checker's later approval.
 * Idempotency comes from the consumer's conditional UPDATE (only a pending,
 * unpaid arrear moves, once), not from the message id.
 */
export async function decideArrear(
  ctx: RequestContext, body: { id: string; decision: ArrearDecision; note?: string | undefined },
): Promise<Accepted> {
  await queue.publish(COMMANDS.arrearDecide, {
    messageId: randomUUID(),
    type: COMMANDS.arrearDecide,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, ...body },
  });
  return { id: body.id, status: "accepted", correlationId: ctx.correlationId };
}

export async function setArrearPolicy(ctx: RequestContext, body: ArrearPolicyBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.arrearPolicySet, {
    messageId: id, type: COMMANDS.arrearPolicySet,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
