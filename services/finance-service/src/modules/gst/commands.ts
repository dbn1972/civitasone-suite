import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";

export type Accepted = { id: string; status: string; correlationId: string };

export const GST_LEDGER_EXPORT_TOPIC = "finance.gst.ledger_export_record";

/** GAP-FINANCE-GST-05: records that a finance user exported the GST ledger (audit-on-export). */
export async function recordLedgerExport(
  ctx: RequestContext,
  body: { period: string; rowCount: number; filtered: boolean },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(GST_LEDGER_EXPORT_TOPIC, {
    messageId: id, type: GST_LEDGER_EXPORT_TOPIC,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, period: body.period, rowCount: body.rowCount, filtered: body.filtered },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
