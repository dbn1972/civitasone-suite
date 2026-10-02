/**
 * Disbursement transfer ledger (payroll.disbursement_transfers, migration 0053).
 *
 * Writers -- every one takes the caller's transaction, so RLS (app.tenant_id
 * GUC), the ledger change and its audit outbox row commit or roll back
 * together:
 *   - writeIssuedLines(): bank-transfer/issuance.ts, in the same transaction
 *     (and under the same per-run advisory lock) that records the issuance
 *     and its audit, BEFORE the file is returned. It writes exactly the lines
 *     that are in the file -- nothing else is touched.
 *   - applyNachReturnToTransfers(): the NACH return consumer; settles only
 *     rows of the NACH file the return names.
 *   - retry / manual reconcile: consumer.ts.
 */
import { sql } from "drizzle-orm";
import type { DrizzleTx } from "@civitasone/outbox";
import { HttpError } from "../../shared/context.js";
import { sanitizeAscii } from "../bank-transfer/domain.js";
import type { TransferStatus } from "./schema.js";

export type LedgerFileFormat = "csv" | "nach" | "apbs";

/** Why a line is in a file: never sent before / a queued retry / an explicit full re-issue. */
export type LineKind = "first" | "retry" | "full_reissue";

export interface IssuedLine {
  kind: LineKind;
  slipId: string;
  employeeId: string;
  employeeNo: string;
  beneficiaryName: string;
  amountMinor: bigint;
  /** IFSC exactly as written into the file. */
  ifsc: string;
  /** Last 4 of the account exactly as written into the file; never the full number. */
  accountLast4: string | null;
  /** Name of the (part) file this line is in -- what a bank return names. */
  fileReference: string;
  /** retry: the pending attempt being sent. full_reissue: the current attempt being duplicated. */
  transferId?: string | undefined;
  /** full_reissue: attempt number of transferId. */
  attemptNo?: number | undefined;
}

export interface WriteIssuedLinesInput {
  tenantId: string;
  actorId: string;
  runId: string;
  issuanceId: string;
  format: LedgerFileFormat;
  fullReissueReason: string | null;
  lines: IssuedLine[];
}

/** Last 4 alphanumerics of an account number; null when there are not more than 4 (nothing safe to show). */
export function accountLast4(accountNo: string | null | undefined): string | null {
  const cleaned = (accountNo ?? "").replace(/[^0-9A-Za-z]/g, "");
  return cleaned.length > 4 ? cleaned.slice(-4) : null;
}

function rowsOf<T>(result: unknown): T[] {
  return Array.from(result as Iterable<T>);
}

/**
 * Record exactly the issued lines. Throws (rolling the whole issuance back,
 * so no file is returned) if any write does not land on exactly the rows the
 * caller planned -- e.g. a root already exists, or a retry is no longer
 * pending.
 */
export async function writeIssuedLines(tx: DrizzleTx, input: WriteIssuedLinesInput): Promise<void> {
  const { tenantId, actorId, runId, issuanceId, format } = input;
  const json = (ls: IssuedLine[]) => JSON.stringify(ls.map((l) => ({
    slip_id: l.slipId,
    employee_id: l.employeeId,
    employee_no: l.employeeNo,
    beneficiary_name: l.beneficiaryName,
    amount_minor: l.amountMinor.toString(),
    ifsc: l.ifsc,
    account_last4: l.accountLast4,
    file_reference: l.fileReference,
    transfer_id: l.transferId ?? null,
    next_attempt: (l.attemptNo ?? 0) + 1,
  })));

  const first = input.lines.filter((l) => l.kind === "first");
  const retry = input.lines.filter((l) => l.kind === "retry");
  const full = input.lines.filter((l) => l.kind === "full_reissue");

  if (first.length > 0) {
    const inserted = rowsOf<{ id: string }>(await tx.execute(sql`
      INSERT INTO payroll.disbursement_transfers
        (tenant_id, run_id, slip_id, employee_id, employee_no, beneficiary_name, amount_minor,
         ifsc, account_last4, issuance_id, file_format, file_reference, status, attempt_no,
         sent_at, created_by, updated_by)
      SELECT ${tenantId}::uuid, ${runId}::uuid, m.slip_id, m.employee_id, m.employee_no, m.beneficiary_name,
             m.amount_minor::bigint, m.ifsc, m.account_last4, ${issuanceId}::uuid, ${format}, m.file_reference,
             'sent', 1, now(), ${actorId}::uuid, ${actorId}::uuid
        FROM jsonb_to_recordset(${json(first)}::jsonb) AS m(
               slip_id uuid, employee_id uuid, employee_no text, beneficiary_name text,
               amount_minor text, ifsc text, account_last4 text, file_reference text)
      ON CONFLICT (tenant_id, run_id, employee_id) WHERE parent_transfer_id IS NULL DO NOTHING
      RETURNING id
    `));
    if (inserted.length !== first.length) throw new HttpError(409, "LEDGER_CHANGED", "an attempt-1 transfer row already exists for a line planned as first; retry the request");
  }

  if (retry.length > 0) {
    const updated = rowsOf<{ id: string }>(await tx.execute(sql`
      UPDATE payroll.disbursement_transfers t
         SET status = 'sent', issuance_id = ${issuanceId}::uuid, file_format = ${format},
             file_reference = m.file_reference, ifsc = m.ifsc, account_last4 = m.account_last4,
             beneficiary_name = m.beneficiary_name, sent_at = now(), updated_at = now(),
             updated_by = ${actorId}::uuid
        FROM jsonb_to_recordset(${json(retry)}::jsonb) AS m(
               transfer_id uuid, amount_minor text, beneficiary_name text, ifsc text,
               account_last4 text, file_reference text)
       WHERE t.id = m.transfer_id AND t.tenant_id = ${tenantId}::uuid AND t.run_id = ${runId}::uuid
         AND t.status = 'pending' AND t.amount_minor = m.amount_minor::bigint
      RETURNING t.id
    `));
    if (updated.length !== retry.length) throw new HttpError(409, "LEDGER_CHANGED", "a queued retry is no longer pending; retry the request");
  }

  if (full.length > 0) {
    const inserted = rowsOf<{ id: string }>(await tx.execute(sql`
      INSERT INTO payroll.disbursement_transfers
        (tenant_id, run_id, slip_id, employee_id, employee_no, beneficiary_name, amount_minor,
         ifsc, account_last4, issuance_id, file_format, file_reference, status, attempt_no,
         parent_transfer_id, request_reason, sent_at, created_by, updated_by)
      SELECT ${tenantId}::uuid, ${runId}::uuid, m.slip_id, m.employee_id, m.employee_no, m.beneficiary_name,
             m.amount_minor::bigint, m.ifsc, m.account_last4, ${issuanceId}::uuid, ${format}, m.file_reference,
             'sent', m.next_attempt, m.transfer_id, ${input.fullReissueReason}, now(), ${actorId}::uuid, ${actorId}::uuid
        FROM jsonb_to_recordset(${json(full)}::jsonb) AS m(
               slip_id uuid, employee_id uuid, employee_no text, beneficiary_name text, amount_minor text,
               ifsc text, account_last4 text, file_reference text, transfer_id uuid, next_attempt int)
      RETURNING id
    `));
    if (inserted.length !== full.length) throw new HttpError(409, "LEDGER_CHANGED", "full re-issue rows could not be recorded; retry the request");
  }
}

export interface NachReturnLedgerRecord {
  reference: string;
  amountMinor: bigint;
  statusCode: string;
  reasonCode: string;
  reasonText: string;
}

export interface NachReversal {
  transferId: string;
  fromStatus: "success";
  toStatus: "returned" | "failed";
  reasonCode: string | null;
  amountMinor: string;
}

/** A credit confirmed for an attempt that was superseded by a newer one (e.g. after a full re-issue): the payee may have been paid twice. */
export interface NachDuplicateCredit {
  transferId: string;
  childTransferId: string;
  fileReference: string;
  amountMinor: string;
}

export interface NachReturnLedgerResult {
  matched: number;
  unmatched: number;
  success: number;
  returned: number;
  failed: number;
  /** success -> returned/failed transitions: each needs a human to check money really came back. */
  reversals: NachReversal[];
  duplicateCredits: NachDuplicateCredit[];
}

/** NACH return status code -> ledger status. "0" credited, "1" returned, anything else failed. */
export function nachStatusToLedger(statusCode: string): Extract<TransferStatus, "success" | "returned" | "failed"> {
  if (statusCode === "0") return "success";
  if (statusCode === "1") return "returned";
  return "failed";
}

/**
 * Apply parsed NACH return records to the ledger. Only rows of the NACH file
 * the return answers (file_reference) are candidates -- the file pins the
 * attempt, so a superseded attempt (one with a newer retry/re-issue child) is
 * still matched: the bank really did act on that file. Rows must be in 'sent'
 * or 'success'. A record matches when
 * its originator reference (sanitizeAscii(employeeNo, 20), as the writer put
 * it) AND amount both agree; anything else is unmatched and changes nothing.
 * fileReference null (a run with no NACH ledger rows) matches nothing.
 */
export async function applyNachReturnToTransfers(
  tx: DrizzleTx,
  input: { tenantId: string; actorId: string; runId: string; fileReference: string | null; records: NachReturnLedgerRecord[] },
): Promise<NachReturnLedgerResult> {
  const result: NachReturnLedgerResult = { matched: 0, unmatched: 0, success: 0, returned: 0, failed: 0, reversals: [], duplicateCredits: [] };
  if (input.fileReference === null) {
    result.unmatched = input.records.length;
    return result;
  }
  const candidates = rowsOf<{ id: string; employee_no: string; amount_minor: string; status: string; child_id: string | null }>(await tx.execute(sql`
    SELECT t.id, t.employee_no, t.amount_minor::text AS amount_minor, t.status,
           (SELECT c.id FROM payroll.disbursement_transfers c WHERE c.parent_transfer_id = t.id LIMIT 1) AS child_id
      FROM payroll.disbursement_transfers t
     WHERE t.tenant_id = ${input.tenantId}::uuid AND t.run_id = ${input.runId}::uuid
       AND t.file_format = 'nach' AND t.file_reference = ${input.fileReference}
       AND t.status IN ('sent', 'success')
     FOR UPDATE OF t
  `));
  const byRef = new Map<string, Array<{ id: string; amountMinor: bigint; status: string; childId: string | null }>>();
  for (const c of candidates) {
    const ref = sanitizeAscii(c.employee_no, 20).trim();
    const list = byRef.get(ref) ?? [];
    list.push({ id: c.id, amountMinor: BigInt(c.amount_minor), status: c.status, childId: c.child_id });
    byRef.set(ref, list);
  }

  const used = new Set<string>();
  for (const r of input.records) {
    const hit = (byRef.get(r.reference.trim()) ?? []).find((c) => c.amountMinor === r.amountMinor && !used.has(c.id));
    if (!hit) {
      result.unmatched++;
      continue;
    }
    used.add(hit.id);
    const status = nachStatusToLedger(r.statusCode);
    const reasonCode = status === "success" ? null : (r.reasonCode || null);
    const reasonText = status === "success" ? null : (r.reasonText || null);
    await tx.execute(sql`
      UPDATE payroll.disbursement_transfers
         SET status = ${status}, reason_code = ${reasonCode}, reason_text = ${reasonText},
             settled_at = now(), updated_at = now(), updated_by = ${input.actorId}::uuid
       WHERE id = ${hit.id}::uuid AND tenant_id = ${input.tenantId}::uuid
    `);
    if (status === "success" && hit.childId) {
      result.duplicateCredits.push({
        transferId: hit.id, childTransferId: hit.childId, fileReference: input.fileReference,
        amountMinor: hit.amountMinor.toString(),
      });
    }
    if (hit.status === "success" && status !== "success") {
      result.reversals.push({
        transferId: hit.id, fromStatus: "success", toStatus: status, reasonCode, amountMinor: hit.amountMinor.toString(),
      });
    }
    result.matched++;
    result[status]++;
  }
  return result;
}
