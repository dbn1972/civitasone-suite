/**
 * Bank-file issuance: decides which lines a bank file may carry, and records
 * the issuance, its ledger rows and its audit event in ONE transaction before
 * the file is handed back (GAP-PAYROLL-DISBURSEMENT-TRANSFERS, review D2/D5).
 *
 * Synchronous on purpose, like payroll/commands.ts createRun: the decision
 * "who is in this file" must be made and recorded atomically under a per-run
 * advisory lock, or two clicks / a lagging ledger could put the same employee
 * in two files. There is therefore no window in which a file exists without
 * its ledger rows (the earlier async ledger command is gone).
 *
 * What a file carries:
 *   - first file of a run (no ledger rows yet): every payable slip;
 *   - any later file ("incremental", the default): only payable slips that
 *     were never sent, plus queued retries (current attempt 'pending').
 *     Nothing to send -> 409 NOTHING_TO_ISSUE, or 409
 *     REISSUE_WOULD_DUPLICATE_PAYMENT when the only candidates are rows
 *     already sent or paid;
 *   - "full_reissue": every payable slip again, ONLY with fullReissue=true +
 *     a reason (admin-only, enforced by the route); each duplicated line is
 *     recorded as a new attempt and the audit counts what is being paid again.
 * Only slips whose status is in PAYABLE_SLIP_STATUSES are payable.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { HttpError } from "../../shared/context.js";
import type { Beneficiary } from "./beneficiaries.js";
import { accountLast4, writeIssuedLines, type IssuedLine, type LedgerFileFormat, type LineKind } from "../disbursement-transfers/ledger.js";
import { disbursementFileIssuances, type IssuanceMode } from "../disbursement-transfers/schema.js";

const AUDIT_TOPIC = "audit.event.record";

export type PayableSlip = { id: string; employeeId: string; employeeNo: string; netPayMinor: bigint };

/**
 * Review R5: slips are paid by ALLOW-LIST. payroll_slips_status_check allows
 * computed | approved | paid | held | exception. computed/approved are the
 * slips of an approved run; paid is what markSlipsPaidForRun sets on
 * disbursement (so a re-issue of a disbursed run still sees them). 'held'
 * (pay deliberately withheld) and 'exception' (negative net) are never paid,
 * and any status added later is unpaid until someone adds it here.
 */
export const PAYABLE_SLIP_STATUSES: readonly string[] = ["computed", "approved", "paid"];

/** A planned file line. accountNo is the full number for the file body only -- it is never persisted. */
export type PlannedLine = {
  kind: LineKind;
  slipId: string;
  employeeId: string;
  employeeNo: string;
  name: string;
  amountMinor: bigint;
  ifsc: string;
  accountNo: string;
  transferId?: string | undefined;
  attemptNo?: number | undefined;
};

export type RenderedFile = {
  body: string | Buffer;
  contentType: string;
  downloadName: string;
  fileCount: number;
  /** Per planned line (same order): name of the part file it is in. */
  lineFileRefs: string[];
  batchFrom: number | null;
  batchTo: number | null;
};

/** Pure: builds the file from the planned lines; throws HttpError (e.g. 422) to abort the issuance. */
export type Renderer = (lines: PlannedLine[], at: { seq: number; batchBase: number }) => RenderedFile;

export type IssueInput = {
  ctx: RequestContext;
  run: { id: string; runNo: string; month: string; totalNetMinor: bigint };
  format: LedgerFileFormat;
  payableSlips: PayableSlip[];
  /** Slips left out because their status is not payable, counted by status (e.g. { held: 1, exception: 2 }). */
  excludedSlips: Record<string, number>;
  master: Map<string, Beneficiary>;
  reason: string;
  fullReissue: boolean;
  fullReissueReason: string | null;
  render: Renderer;
};

export type IssueResult = { file: RenderedFile; issuanceId: string; mode: IssuanceMode; lineCount: number; totalMinor: bigint };

type StatusCounts = { pending: number; sent: number; success: number; failed: number; returned: number };
const zeroCounts = (): StatusCounts => ({ pending: 0, sent: 0, success: 0, failed: 0, returned: 0 });

function rowsOf<T>(r: unknown): T[] {
  return Array.from(r as Iterable<T>);
}

export async function issueBankFile(input: IssueInput): Promise<IssueResult> {
  const { ctx, run, format } = input;
  return db.transaction(async (tx) => {
    // Review R3: never queue behind another issuance of the same run -- tell
    // the caller instead (the other request decides who is in its file).
    const locked = rowsOf<{ ok: boolean }>(await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${`disbursement-bank-file:${ctx.tenantId}:${run.id}`}, 0)) AS ok`))[0]?.ok;
    if (!locked) {
      throw new HttpError(409, "ISSUANCE_IN_PROGRESS", "another bank file for this run is being generated right now; try again in a moment");
    }

    const ledger = rowsOf<{
      id: string; employee_id: string; amount_minor: string; status: keyof StatusCounts;
      attempt_no: number; parent_transfer_id: string | null; is_leaf: boolean;
    }>(await tx.execute(sql`
      SELECT t.id, t.employee_id, t.amount_minor::text AS amount_minor, t.status, t.attempt_no, t.parent_transfer_id,
             NOT EXISTS (SELECT 1 FROM payroll.disbursement_transfers c WHERE c.parent_transfer_id = t.id) AS is_leaf
        FROM payroll.disbursement_transfers t
       WHERE t.tenant_id = ${ctx.tenantId}::uuid AND t.run_id = ${run.id}::uuid
    `));
    const roots = new Map(ledger.filter((r) => r.parent_transfer_id === null).map((r) => [r.employee_id, r]));
    const leaves = new Map(ledger.filter((r) => r.is_leaf).map((r) => [r.employee_id, r]));

    // The run's money must not have moved under an already-issued file.
    const net = new Map(input.payableSlips.map((s) => [s.employeeId, s.netPayMinor]));
    const drift = [...roots.values()].filter((r) => net.get(r.employee_id) !== BigInt(r.amount_minor));
    if (drift.length > 0) {
      throw new HttpError(409, "LEDGER_MISMATCH",
        `${drift.length} transfer ledger row(s) for this run no longer match its payable salary slips; no file can be issued until this is investigated`);
    }

    const mode: IssuanceMode = roots.size === 0 ? "first" : input.fullReissue ? "full_reissue" : "incremental";
    const lines: PlannedLine[] = [];
    const notIncluded = zeroCounts();
    const paidAgain = zeroCounts();
    for (const slip of input.payableSlips) {
      const b = input.master.get(slip.employeeId);
      const base = {
        slipId: slip.id, employeeId: slip.employeeId, employeeNo: slip.employeeNo,
        name: b?.fullName ?? slip.employeeNo, amountMinor: slip.netPayMinor,
        ifsc: (b?.bankIfsc ?? "").trim().toUpperCase(), accountNo: (b?.bankAccountNo ?? "").trim(),
      };
      const leaf = leaves.get(slip.employeeId);
      if (!roots.has(slip.employeeId) || !leaf) {
        lines.push({ ...base, kind: "first" });
      } else if (leaf.status === "pending") {
        lines.push({ ...base, kind: "retry", transferId: leaf.id });
      } else if (mode === "full_reissue") {
        paidAgain[leaf.status]++;
        lines.push({ ...base, kind: "full_reissue", transferId: leaf.id, attemptNo: leaf.attempt_no });
      } else {
        notIncluded[leaf.status]++;
      }
    }

    if (lines.length === 0) {
      if (notIncluded.success + notIncluded.sent > 0) {
        throw new HttpError(409, "REISSUE_WOULD_DUPLICATE_PAYMENT",
          `nothing new to pay: ${notIncluded.success} transfer(s) already credited (success) and ${notIncluded.sent} already sent ` +
          `(${notIncluded.failed} failed, ${notIncluded.returned} returned without a queued retry). A file now would pay them twice; ` +
          `queue a retry for a failed/returned transfer, or (payroll_admin) request an audited full re-issue with fullReissue=true and fullReissueReason`);
      }
      throw new HttpError(409, "NOTHING_TO_ISSUE",
        `no transfer of this run is waiting to be sent (${notIncluded.failed} failed, ${notIncluded.returned} returned without a queued retry)`);
    }

    const seqRow = rowsOf<{ seq: number; batch_base: number }>(await tx.execute(sql`
      SELECT COALESCE(MAX(seq), 0) + 1 AS seq, COALESCE(MAX(batch_to), 0) + 1 AS batch_base
        FROM payroll.disbursement_file_issuances
       WHERE tenant_id = ${ctx.tenantId}::uuid AND run_id = ${run.id}::uuid
    `))[0]!;
    const seq = Number(seqRow.seq);
    const file = input.render(lines, { seq, batchBase: Number(seqRow.batch_base) });
    const totalMinor = lines.reduce((s, l) => s + l.amountMinor, 0n);
    const issuanceId = randomUUID();

    await tx.insert(disbursementFileIssuances).values({
      id: issuanceId,
      tenantId: ctx.tenantId,
      runId: run.id,
      seq,
      mode,
      fileFormat: format,
      fileName: file.downloadName,
      batchFrom: file.batchFrom,
      batchTo: file.batchTo,
      lineCount: lines.length,
      totalMinor,
      reason: input.reason,
      fullReissueReason: mode === "full_reissue" ? input.fullReissueReason : null,
      createdBy: ctx.actorId,
    });

    const issued: IssuedLine[] = lines.map((l, i) => ({
      kind: l.kind, slipId: l.slipId, employeeId: l.employeeId, employeeNo: l.employeeNo,
      beneficiaryName: l.name, amountMinor: l.amountMinor, ifsc: l.ifsc,
      accountLast4: accountLast4(l.accountNo), fileReference: file.lineFileRefs[i]!,
      transferId: l.transferId, attemptNo: l.attemptNo,
    }));
    await writeIssuedLines(tx, {
      tenantId: ctx.tenantId, actorId: ctx.actorId, runId: run.id, issuanceId, format,
      fullReissueReason: mode === "full_reissue" ? input.fullReissueReason : null, lines: issued,
    });

    const rootTotal = BigInt(rowsOf<{ t: string }>(await tx.execute(sql`
      SELECT COALESCE(SUM(amount_minor), 0)::text AS t FROM payroll.disbursement_transfers
       WHERE tenant_id = ${ctx.tenantId}::uuid AND run_id = ${run.id}::uuid AND parent_transfer_id IS NULL
    `))[0]!.t);

    const kinds = { first: 0, retry: 0, full_reissue: 0 };
    for (const l of lines) kinds[l.kind]++;
    await enqueue(tx, {
      topic: AUDIT_TOPIC,
      eventType: AUDIT_TOPIC,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      payload: {
        service: "payroll",
        action: mode === "first" ? "bank_file_generated" : mode === "incremental" ? "bank_file_reissued" : "bank_file_full_reissued",
        resourceType: "payroll_run",
        resourceId: run.id,
        outcome: "success",
        detail: {
          issuanceId,
          seq,
          mode,
          format,
          fileName: file.downloadName,
          fileCount: file.fileCount,
          recordCount: lines.length,
          totalAmountMinor: totalMinor.toString(),
          lineKinds: kinds,
          reason: input.reason,
          reissue: mode !== "first",
          ...(mode === "full_reissue" ? { fullReissueReason: input.fullReissueReason, paidAgain } : {}),
          notIncluded,
          excludedSlips: input.excludedSlips,
          // Ledger attempt-1 total vs the run's stored net pay.
          ledgerRootTotalMinor: rootTotal.toString(),
          runTotalNetMinor: run.totalNetMinor.toString(),
          totalsReconcile: rootTotal === run.totalNetMinor,
          signed: false,
        },
      },
    });

    return { file, issuanceId, mode, lineCount: lines.length, totalMinor };
  });
}
