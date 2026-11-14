/**
 * M9: payroll without Finance (export-only ledger mode) routes.
 *
 *   GET  /v1/payroll/ledger-mode                       the tenant's mode, where it comes from
 *   GET  /v1/payroll/runs/:id/journal-export           the run's salary journals, ?format=csv|tally&stage=accrual|disbursement
 *   POST /v1/payroll/runs/:id/bank-confirmation        the bank's success file; marks slips paid (export mode only)
 *
 * Nothing here is reachable in a way that changes a finance-mode tenant: the
 * export returns 409 and the confirmation 409 for one, and the mode read is
 * the only thing they share with the rest of payroll.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { deterministicUuid } from "../../shared/deterministic-id.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "../payroll/repo.js";
import { resolveLedgerModeDetail } from "./mode.js";
import { listJournals } from "./repo.js";
import { journalsToCsv, journalsToTallyXml } from "./journal.js";
import { parseBankConfirmation, bankConfirmationHash } from "./bank-confirmation.js";
import { BANK_CONFIRMATION_NOT_ENABLED, RUN_NOT_DISBURSED } from "./consumer.js";

const READ_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin"];
const EXPORT_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
/** Marking salaries paid is a money record: admins only, like a manual transfer reconcile. */
const CONFIRM_ROLES = ["payroll_admin", "super_admin"];

const idParams = z.object({ id: z.string().uuid() });
const exportQuery = z.object({
  format: z.enum(["csv", "tally"]).default("csv"),
  stage: z.enum(["accrual", "disbursement"]).optional(),
});

export const LEDGER_EXPORT_NOT_ENABLED = "LEDGER_EXPORT_NOT_ENABLED";

export async function ledgerExportRoutes(app: FastifyInstance): Promise<void> {
  // Raw text bodies for a pasted / uploaded bank file (JSON { content } is handled by the default parser).
  app.addContentTypeParser(["text/plain", "text/csv"], { parseAs: "string" }, (_req, body, done) => { done(null, body); });

  app.get("/v1/payroll/ledger-mode", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const d = await resolveLedgerModeDetail(ctx.tenantId);
    return reply.send({ mode: d.mode, source: d.source, override: d.override, hasFinance: d.hasFinance });
  });

  app.get("/v1/payroll/runs/:id/journal-export", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EXPORT_ROLES);
    const { id: runId } = idParams.parse(req.params);
    const q = exportQuery.parse(req.query);
    const run = await repo.findRunById(runId, ctx.tenantId);
    if (!run) throw new HttpError(404, "NOT_FOUND", "payroll run not found");
    const all = await listJournals(ctx.tenantId, runId);
    if (all.length === 0) {
      // Not yet approved: the run has no pinned mode, so the tenant's current mode says whether a journal is coming.
      // Approved (or later): the run's own pinned mode does.
      const pinned = run.ledgerMode === "export" ? "export" : (run.approvedAt ? "finance" : (await resolveLedgerModeDetail(ctx.tenantId)).mode);
      if (pinned !== "export") {
        throw new HttpError(409, LEDGER_EXPORT_NOT_ENABLED, "this run posts salary journals to finance; there is no export to download");
      }
      throw new HttpError(404, "JOURNAL_NOT_READY", "the journal is produced when the run is approved (accrual) and disbursed (settlement)");
    }
    const journals = q.stage ? all.filter((j) => j.stage === q.stage) : all;
    if (journals.length === 0) throw new HttpError(404, "JOURNAL_NOT_READY", `no ${q.stage} journal exists for this run yet`);
    const base = `payroll-journal-${run.month}-${runId.slice(0, 8)}${q.stage ? `-${q.stage}` : ""}`;
    if (q.format === "tally") {
      return reply.header("content-type", "application/xml; charset=utf-8").header("content-disposition", `attachment; filename="${base}.xml"`).send(journalsToTallyXml(journals));
    }
    return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="${base}.csv"`).send(journalsToCsv(journals));
  });

  app.post("/v1/payroll/runs/:id/bank-confirmation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIRM_ROLES);
    const { id: runId } = idParams.parse(req.params);

    let content: string;
    if (typeof req.body === "string") content = req.body;
    else if (req.body && typeof req.body === "object" && "content" in (req.body as Record<string, unknown>)) content = String((req.body as Record<string, unknown>).content);
    else throw new HttpError(400, "INVALID_REQUEST", "request body must be the bank file (text/csv or text/plain) or JSON with { content: string }");
    if (content.trim() === "") throw new HttpError(400, "INVALID_REQUEST", "file content is empty");

    const run = await repo.findRunById(runId, ctx.tenantId);
    if (!run) throw new HttpError(404, "NOT_FOUND", "payroll run not found");
    // The run's own pinned mode (set when it was approved), not the tenant's current one.
    if (run.ledgerMode !== "export") {
      throw new HttpError(409, BANK_CONFIRMATION_NOT_ENABLED, "this run posts salary to finance; slips are marked paid when finance confirms the payment");
    }
    if (run.status !== "disbursed") {
      throw new HttpError(409, RUN_NOT_DISBURSED, `a bank confirmation applies to a disbursed run (current status: ${run.status})`);
    }

    const parsed = parseBankConfirmation(content);
    if (parsed.errors.length > 0) {
      throw new HttpError(400, "INVALID_BANK_FILE", `${parsed.errors.length} row(s) could not be read; first: line ${parsed.errors[0]!.line}, ${parsed.errors[0]!.message}`);
    }
    if (parsed.records.length === 0) throw new HttpError(400, "INVALID_BANK_FILE", "the file has no rows");

    // The same file for the same run is one message: re-sending it changes nothing.
    const fileHash = bankConfirmationHash(content);
    const messageId = deterministicUuid(`payroll-bank-confirmation:${ctx.tenantId}:${runId}:${fileHash}`);
    await queue.publish(COMMANDS.runBankConfirmation, {
      messageId, type: COMMANDS.runBankConfirmation,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: {
        runId, fileHash,
        records: parsed.records.map((r) => ({ employeeNo: r.employeeNo, amountMinor: r.amountMinor === null ? null : r.amountMinor.toString(), utr: r.utr, outcome: r.outcome })),
      },
    });
    const succeeded = parsed.records.filter((r) => r.outcome === "success").length;
    return reply.status(202).send({ data: { id: messageId, rows: parsed.records.length, success: succeeded, failed: parsed.records.length - succeeded, fileHash } });
  });
}
