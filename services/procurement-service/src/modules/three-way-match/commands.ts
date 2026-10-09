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
    // GAP2-PROCUREMENT-THREEWAYMATCH-01: accept the paise either as a number
    // (the direct POST /three-way-match endpoint sends z.number().int()) or an
    // exact base-10 string (POST /matches/invoice, after float-free rupees->paise
    // conversion). The consumer rebuilds a bigint with BigInt(...), which accepts
    // both, so no float ever touches the amount.
    invoiceAmountMinor?: number | string | undefined;
    /** DOM-027: audited invoice reference. Required by the callers (routes.ts) whenever invoice info is present. */
    invoiceRef?: string | undefined;
    /** DOM-032: invoice date as supplied by the client. Optional on its one caller (matches/invoice's invoiceAttachBody) -- see routes.ts. */
    invoiceDate?: string | undefined;
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
