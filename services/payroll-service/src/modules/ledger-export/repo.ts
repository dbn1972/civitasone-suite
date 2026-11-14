/**
 * M9: persistence for the export-only ledger mode. Every writer takes the
 * caller's transaction (RLS GUC, the status change and the audit row commit or
 * roll back together); readers go through scopedRead.
 */
import { sql } from "drizzle-orm";
import type { DrizzleTx } from "@civitasone/outbox";
import { scopedRead } from "../../shared/db.js";
import type { JournalLine, JournalStage, StoredJournal } from "./journal.js";

const rowsOf = <T>(r: unknown): T[] => Array.from(r as Iterable<T>);

type WireLine = { accountCode: string; debitMinor: string; creditMinor: string; narration: string };
const toWire = (ls: JournalLine[]): WireLine[] => ls.map((l) => ({ accountCode: l.accountCode, debitMinor: l.debitMinor.toString(), creditMinor: l.creditMinor.toString(), narration: l.narration }));
const fromWire = (ls: WireLine[]): JournalLine[] => ls.map((l) => ({ accountCode: l.accountCode, debitMinor: BigInt(l.debitMinor), creditMinor: BigInt(l.creditMinor), narration: l.narration }));

/** Insert the run's journal for the stage; false when one already exists (a redelivery). */
export async function storeJournalTx(tx: DrizzleTx, j: {
  tenantId: string; actorId: string; runId: string; stage: JournalStage; voucherNo: string; postingDate: string; month: string; lines: JournalLine[];
}): Promise<boolean> {
  const rows = rowsOf<{ id: string }>(await tx.execute(sql`
    INSERT INTO payroll.payroll_journal_exports (tenant_id, run_id, stage, voucher_no, posting_date, month, lines, created_by)
    VALUES (${j.tenantId}::uuid, ${j.runId}::uuid, ${j.stage}, ${j.voucherNo}, ${j.postingDate}::date, ${j.month},
            ${JSON.stringify(toWire(j.lines))}::jsonb, ${j.actorId}::uuid)
    ON CONFLICT (tenant_id, run_id, stage) DO NOTHING
    RETURNING id
  `));
  return rows.length > 0;
}

export async function listJournals(tenantId: string, runId: string): Promise<StoredJournal[]> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT stage, voucher_no, posting_date::text AS posting_date, month, run_id::text AS run_id, lines
      FROM payroll.payroll_journal_exports
     WHERE tenant_id = ${tenantId}::uuid AND run_id = ${runId}::uuid
     ORDER BY CASE stage WHEN 'accrual' THEN 0 ELSE 1 END
  `))) as unknown as Array<{ stage: JournalStage; voucher_no: string; posting_date: string; month: string; run_id: string; lines: WireLine[] }>;
  return rows.map((r) => ({
    stage: r.stage, voucherNo: r.voucher_no, postingDate: r.posting_date, month: r.month, runId: r.run_id, lines: fromWire(r.lines),
  }));
}

/** Slip statuses that never move to paid: negative-net exception, Rs 0-basic exclusion, and already paid. */
const NEVER_PAID = sql`('exception', 'excluded', 'paid')`;

/** Mark these employees' slips of the run paid; returns the slip ids that moved. */
export async function markSlipsPaidForEmployeesTx(tx: DrizzleTx, p: { tenantId: string; runId: string; actorId: string; employeeIds: string[] }): Promise<string[]> {
  if (p.employeeIds.length === 0) return [];
  const ids = sql.join(p.employeeIds.map((e) => sql`${e}::uuid`), sql`, `);
  const rows = rowsOf<{ id: string }>(await tx.execute(sql`
    UPDATE payroll.payroll_slips SET status = 'paid', updated_at = now(), updated_by = ${p.actorId}::uuid
     WHERE tenant_id = ${p.tenantId}::uuid AND run_id = ${p.runId}::uuid
       AND employee_id IN (${ids}) AND status NOT IN ${NEVER_PAID}
    RETURNING id::text AS id
  `));
  return rows.map((r) => r.id);
}

/**
 * Mark paid every slip of the run whose bank transfer the ledger has settled
 * 'success' (NACH return credit, manual reconcile). Idempotent.
 */
export async function markSlipsPaidFromSettledTransfersTx(tx: DrizzleTx, p: { tenantId: string; runId: string; actorId: string }): Promise<string[]> {
  const rows = rowsOf<{ id: string }>(await tx.execute(sql`
    UPDATE payroll.payroll_slips s SET status = 'paid', updated_at = now(), updated_by = ${p.actorId}::uuid
     WHERE s.tenant_id = ${p.tenantId}::uuid AND s.run_id = ${p.runId}::uuid AND s.status NOT IN ${NEVER_PAID}
       AND EXISTS (
         SELECT 1 FROM payroll.disbursement_transfers t
          WHERE t.tenant_id = s.tenant_id AND t.run_id = s.run_id AND t.employee_id = s.employee_id AND t.status = 'success')
    RETURNING s.id::text AS id
  `));
  return rows.map((r) => r.id);
}

/** Settle the still-'sent' transfer rows of these employees from a bank confirmation file. */
export async function settleSentTransfersTx(tx: DrizzleTx, p: {
  tenantId: string; runId: string; actorId: string; employeeIds: string[]; outcome: "success" | "failed"; reasonText: string | null;
}): Promise<number> {
  if (p.employeeIds.length === 0) return 0;
  const ids = sql.join(p.employeeIds.map((e) => sql`${e}::uuid`), sql`, `);
  const rows = rowsOf<{ id: string }>(await tx.execute(sql`
    UPDATE payroll.disbursement_transfers
       SET status = ${p.outcome}, reason_code = ${p.outcome === "success" ? null : "BANKFILE"}, reason_text = ${p.outcome === "success" ? null : p.reasonText},
           settled_at = now(), updated_at = now(), updated_by = ${p.actorId}::uuid
     WHERE tenant_id = ${p.tenantId}::uuid AND run_id = ${p.runId}::uuid AND employee_id IN (${ids}) AND status = 'sent'
    RETURNING id::text AS id
  `));
  return rows.length;
}
