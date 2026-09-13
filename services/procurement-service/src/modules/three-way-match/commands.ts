import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function runThreeWayMatch(
  ctx: RequestContext,
  body: {
    poId: string;
    grnId: string;
    invoiceId?: string | undefined;
    invoiceAmountMinor?: number | undefined;
    /** DOM-027: audited invoice reference. Required by the callers (routes.ts) whenever invoice info is present. */
    invoiceRef?: string | undefined;
  },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.threeWayMatchRun, {
    messageId: id,
    type: COMMANDS.threeWayMatchRun,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
