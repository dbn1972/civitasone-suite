/**
 * MSME M3a: the GST PRODUCER. Emits `finance.gst.entry_record` through the transactional outbox, in the SAME transaction as the GL
 * ledger lines (called from gl/consumer.ts postJournal), so a GL line and its GST row either both exist or neither does -- the
 * ledger cannot drift from the books. The outbox is written on the caller's transaction handle, which already carries the tenant GUC
 * (runWithTenant + db.transaction); _outbox.messages is FORCE-RLS on the dev DB regardless of what a migration comment says.
 *
 * GATE (in the posting tx, never default-on): the entry is emitted only when gl.finance_settings.gst_registered AND the stored
 * coa_template is not 'govt'. When a journal carries GST but the gate is closed it is REFUSED (GST_NOT_REGISTERED), not silently posted
 * without its GST rows: a GST-bearing journal on an unregistered/govt tenant is a configuration contradiction, and posting only half of it
 * would be the drift this design exists to prevent. Gated on stored settings only -- never on edition / profile.
 */
import { NonRetryableError } from "@civitasone/queue";
import { enqueue } from "../../shared/outbox.js";
import { loadSettingsTx } from "../approvals/repo.js";
import { loadPostingSettingsTx } from "../approvals/posting-settings.js";
import { deterministicId } from "../gl/spine.js";
import { GST_ITC_HEAD_CODE, RCM_ITC_PENDING_CODE } from "../gl/gst-heads.js";
import type { GstJournalMeta } from "./itc.js";

export const GST_ENTRY_TOPIC = "finance.gst.entry_record";

type Tx = Parameters<typeof enqueue>[0];

/** True only for a GST-registered, non-govt-chart tenant. Pure of edition/profile: stored settings only. */
export async function gstEnabledTx(tx: unknown, tenantId: string): Promise<boolean> {
  const s = await loadSettingsTx(tx as Parameters<typeof loadSettingsTx>[0], tenantId);
  if (s.gstRegistered !== true) return false;
  const ps = await loadPostingSettingsTx(tx, tenantId);
  return ps.coaTemplate !== "govt";
}

export async function assertGstEnabledTx(tx: unknown, tenantId: string): Promise<void> {
  if (!(await gstEnabledTx(tx, tenantId))) {
    throw new NonRetryableError("GST_NOT_REGISTERED: this tenant is not GST-registered on a commercial chart; GST lines cannot be recorded");
  }
}

/** The ISO period (YYYY-MM) of a document date. */
export const gstPeriodOf = (isoDate: string): string => isoDate.slice(0, 7);

/**
 * Called by postJournal after the ledger lines are written, inside its transaction. `journal.gst` is only ever set by a GST-aware
 * producer (bill approval, RCM claim); a journal without it never reaches this function (zero cost for every govt posting).
 */
export async function emitGstEntriesTx(
  tx: Tx,
  msg: { tenantId: string; actorId: string; correlationId: string },
  journal: { id: string; tenantId: string; postingDate: string },
  meta: GstJournalMeta,
  voucherNo: string,
): Promise<void> {
  await assertGstEnabledTx(tx, journal.tenantId);
  const base = { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
  if (meta.rcmClaimOf) {
    // The tax was paid: the pending ITC moves to the per-tax heads. The ledger rows are re-pointed by the consumer (op rcm_claim).
    await enqueue(tx, {
      topic: GST_ENTRY_TOPIC, eventType: GST_ENTRY_TOPIC, ...base,
      payload: {
        op: "rcm_claim", id: deterministicId(`gst-claim:${meta.rcmClaimOf}`), tenantId: journal.tenantId,
        sourceDocType: meta.sourceDocType, sourceDocId: meta.rcmClaimOf, journalId: journal.id, ledgerVoucherNo: voucherNo,
        claimedOn: journal.postingDate, claimFrom: RCM_ITC_PENDING_CODE, claimTo: GST_ITC_HEAD_CODE,
      },
    });
    return;
  }
  // M3b: sales documents emit direction "output" through this same producer (default stays "input" -- M3a bills are unchanged).
  const direction = meta.direction ?? "input";
  for (const e of meta.entries ?? []) {
    await enqueue(tx, {
      topic: GST_ENTRY_TOPIC, eventType: GST_ENTRY_TOPIC, ...base,
      payload: {
        id: deterministicId(`gst:${meta.sourceDocType}:${meta.sourceDocId}:${e.gstType}:${e.ratePct}:${direction}`),
        tenantId: journal.tenantId,
        invoiceId: meta.sourceDocId, invoiceNo: meta.invoiceNo, invoiceDate: meta.invoiceDate,
        partyGstin: meta.partyGstin ?? null, partyName: meta.partyName ?? null,
        gstType: e.gstType, direction, taxableMinor: e.taxableMinor, taxMinor: e.taxMinor, ratePct: e.ratePct,
        ...(e.hsnCode ? { hsnCode: e.hsnCode } : {}), period: gstPeriodOf(meta.invoiceDate),
        sourceDocType: meta.sourceDocType, sourceDocId: meta.sourceDocId, journalId: journal.id, ledgerVoucherNo: voucherNo,
        ...(e.itcCategory ? { itcCategory: e.itcCategory } : {}), rcm: e.rcm, glHeadCode: e.glHeadCode,
      },
    });
  }
}
