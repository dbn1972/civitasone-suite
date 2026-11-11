/**
 * M9: bank confirmation consumer. Marks the slips of a DISBURSED run paid from
 * the bank's success file, for a tenant in export-only ledger mode (no
 * finance.payment.made will ever arrive). A tenant on the finance path never
 * reaches it: the route answers 409 and this consumer drops the command as
 * non-retryable, so the finance-mode flow is untouched.
 */
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "../payroll/repo.js";
import { audit } from "../payroll/consumer.js";
import { resolveLedgerMode } from "./mode.js";
import * as ledgerRepo from "./repo.js";

export const BANK_CONFIRMATION_NOT_ENABLED = "BANK_CONFIRMATION_NOT_ENABLED";
export const RUN_NOT_DISBURSED = "RUN_NOT_DISBURSED";

export interface BankConfirmationPayload {
  runId: string;
  fileHash: string;
  records: Array<{ employeeNo: string; amountMinor: string | null; utr: string | null; outcome: "success" | "failed" }>;
}

/** Audit details list at most this many references per bucket; the counts are always exact. */
const DETAIL_CAP = 200;

export function registerLedgerExportConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.runBankConfirmation, async (msg) => {
    const p = msg.payload as BankConfirmationPayload;
    // HTTP and settings read stay outside the transaction.
    const mode = await resolveLedgerMode(msg.tenantId);
    if (mode !== "export") {
      throw new NonRetryableError(`${BANK_CONFIRMATION_NOT_ENABLED}: this tenant posts salary to finance; slips are marked paid from finance.payment.made`);
    }
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const run = await repo.findRunByIdForUpdateTx(tx, p.runId);
      if (!run) throw new NonRetryableError(`payroll run ${p.runId} not found`);
      if (run.status !== "disbursed") {
        throw new NonRetryableError(`${RUN_NOT_DISBURSED}: a bank confirmation applies to a disbursed run (current status: ${run.status})`);
      }
      const slips = await repo.listSlipsByRunTx(tx, p.runId, msg.tenantId);
      const byNo = new Map(slips.map((s) => [s.employeeNo, s]));

      const paidEmployees: string[] = [];
      const failedEmployees: string[] = [];
      const unknown: string[] = [];
      const notPayable: string[] = [];
      const amountMismatch: Array<{ employeeNo: string; fileMinor: string; slipMinor: string }> = [];
      const seen = new Set<string>();
      let duplicateRows = 0;
      let alreadyPaid = 0;

      for (const r of p.records) {
        const slip = byNo.get(r.employeeNo);
        if (!slip) { unknown.push(r.employeeNo); continue; }
        if (seen.has(r.employeeNo)) { duplicateRows++; continue; }
        seen.add(r.employeeNo);
        if (slip.status === "exception" || slip.status === "excluded") { notPayable.push(r.employeeNo); continue; }
        if (r.amountMinor !== null && BigInt(r.amountMinor) !== slip.netPayMinor) {
          amountMismatch.push({ employeeNo: r.employeeNo, fileMinor: r.amountMinor, slipMinor: slip.netPayMinor.toString() });
          continue;
        }
        if (r.outcome === "failed") { failedEmployees.push(slip.employeeId); continue; }
        if (slip.status === "paid") { alreadyPaid++; continue; }
        paidEmployees.push(slip.employeeId);
      }

      const paidSlipIds = await ledgerRepo.markSlipsPaidForEmployeesTx(tx, {
        tenantId: msg.tenantId, runId: p.runId, actorId: msg.actorId, employeeIds: paidEmployees,
      });
      const settled = await ledgerRepo.settleSentTransfersTx(tx, {
        tenantId: msg.tenantId, runId: p.runId, actorId: msg.actorId, employeeIds: paidEmployees, outcome: "success", reasonText: null,
      });
      const failedTransfers = await ledgerRepo.settleSentTransfersTx(tx, {
        tenantId: msg.tenantId, runId: p.runId, actorId: msg.actorId, employeeIds: failedEmployees, outcome: "failed", reasonText: "reported failed in the bank confirmation file",
      });

      await audit(tx, msg, "bank_confirmation_processed", "payroll_run", p.runId, {
        fileHash: p.fileHash,
        rows: p.records.length,
        slipsMarkedPaid: paidSlipIds.length,
        slipIds: paidSlipIds.slice(0, DETAIL_CAP),
        alreadyPaid,
        reportedFailed: failedEmployees.length,
        transfersSettled: settled,
        transfersFailed: failedTransfers,
        duplicateRows,
        unknownEmployeeNos: unknown.slice(0, DETAIL_CAP),
        notPayableEmployeeNos: notPayable.slice(0, DETAIL_CAP),
        amountMismatch: amountMismatch.slice(0, DETAIL_CAP),
        requiresReview: unknown.length + notPayable.length + amountMismatch.length + failedEmployees.length > 0,
      });
    });
  });
}
