import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { idempotentId } from "@civitasone/auth";
import { queue } from "../../shared/infra.js";

export type Accepted = { id: string; status: string; correlationId: string };

export const GST_LEDGER_EXPORT_TOPIC = "finance.gst.ledger_export_record";
/** MSME M3a: the reverse-charge tax on a bill was paid, so its input tax credit may now be claimed. */
export const RCM_ITC_CLAIM_TOPIC = "finance.gst.rcm_itc_claim";

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

/** MSME M3a: claim the ITC on a reverse-charge bill whose RCM tax has been paid (one claim per bill; the journal id is deterministic). */
export async function claimRcmItc(
  ctx: RequestContext,
  body: { billId: string; paidOn: string; challanRef: string },
): Promise<Accepted> {
  const id = idempotentId({ idempotencyKey: `rcm-itc-claim:${body.billId}`, tenantId: ctx.tenantId });
  await queue.publish(RCM_ITC_CLAIM_TOPIC, {
    messageId: id, type: RCM_ITC_CLAIM_TOPIC,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
