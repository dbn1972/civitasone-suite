import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface EarnCompOffInput {
  employeeId: string; workedDate: string; holidayName: string; hours: number; reason: string;
}

/** V4-B-01: HR grants a comp-off. The row is written by comp-off-consumer.ts. */
export async function earnCompOff(ctx: RequestContext, input: EarnCompOffInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.compOffEarn, {
    messageId: randomUUID(), type: COMMANDS.compOffEarn, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...input },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * V4-B-01: redeem a comp-off. `ownerEmployeeId` is set for non-HR callers so the
 * consumer guarded UPDATE re-asserts ownership (the route check is only a
 * fast-fail; the write itself must not trust it).
 */
export async function redeemCompOff(ctx: RequestContext, id: string, ownerEmployeeId: string | null): Promise<Accepted> {
  await queue.publish(COMMANDS.compOffRedeem, {
    messageId: randomUUID(), type: COMMANDS.compOffRedeem, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ownerEmployeeId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
