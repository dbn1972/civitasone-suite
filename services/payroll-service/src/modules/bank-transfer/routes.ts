import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { eq, and } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { payrollSlips, payrollRuns } from "../payroll/schema.js";
import { loadBeneficiaryMaster } from "./beneficiaries.js";
import { issueBankFile, PAYABLE_SLIP_STATUSES, type PlannedLine, type RenderedFile, type Renderer } from "./issuance.js";
import { findByTenantId } from "../sponsor-config/repo.js";
import type { SponsorBankConfigRow } from "../sponsor-config/schema.js";
import { validateNachBeneficiaries, computeSettlementDate, splitIntoBatches } from "./domain.js";
import type { NachBeneficiary } from "./domain.js";
import { generateBankFile } from "./format-router.js";
import { createZipBuffer } from "./zip-util.js";

const PAYROLL_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
/** A full re-issue pays already-sent/paid employees again: admin only. */
const FULL_REISSUE_ROLES = ["payroll_admin", "super_admin"];

const pathParamSchema = z.object({
  id: z.string().uuid(),
});

/**
 * GAP-PAYROLL-DISBURSEMENT-02: generating a salary payment file is an audited
 * action that requires a stated reason (min 10 chars, same bar as the web
 * ConfirmDialog). The reason travels in a POST body rather than a GET query
 * string so free text never lands in URL access logs.
 *
 * GAP-PAYROLL-DISBURSEMENT-TRANSFERS (review D2): `fullReissue` is the only
 * way to put an already-sent or already-paid employee in a file again; it
 * needs its own reason and is audited as bank_file_full_reissued.
 */
const generateBodySchema = z.object({
  format: z.enum(["csv", "nach", "apbs"]).default("csv"),
  reason: z.string().trim().min(10, "reason must be at least 10 characters").max(500),
  fullReissue: z.boolean().default(false),
  fullReissueReason: z.string().trim().min(10, "fullReissueReason must be at least 10 characters").max(500).optional(),
}).refine((b) => !b.fullReissue || b.fullReissueReason !== undefined, {
  message: "fullReissueReason (min 10 characters) is required when fullReissue is true",
  path: ["fullReissueReason"],
});

/**
 * GAP-PAYROLL-DISBURSEMENT-03: the bank-file path does not sign files with the
 * tenant DSC today (the DSC is only used for Form 16 PDFs). Every response
 * carries this header so a client can show "Signed"/"UNSIGNED" from the
 * server's own statement instead of assuming; it flips to "true" only when
 * real signing is implemented here.
 */
export const BANK_FILE_SIGNED_HEADER = "x-bank-file-signed";
/** Which lines the file carries: first | incremental | full_reissue. */
export const BANK_FILE_MODE_HEADER = "x-bank-file-mode";
export const BANK_FILE_ISSUANCE_HEADER = "x-bank-file-issuance-id";

// H4: CSV injection + delimiter safety. Neutralise spreadsheet formula
// triggers (= + - @, and TAB/CR which Excel also treats as leading) by
// prefixing with a single quote, then quote/escape per RFC 4180 if the
// value contains a comma, quote, CR or LF.
function escapeCsv(raw: string): string {
  let val = raw ?? "";
  if (/^[=+\-@\t\r]/.test(val)) val = `'${val}`;
  if (/[",\r\n]/.test(val)) val = `"${val.replace(/"/g, '""')}"`;
  return val;
}
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/; // RBI IFSC format

/** NEFT/RTGS CSV with a control-total trailer over exactly the planned lines. */
function csvRenderer(run: { runNo: string; month: string }): Renderer {
  return (lines, { seq }) => {
    // Refuse to emit a file with unusable beneficiary rows -- the bank would
    // reject the whole batch, and a partial file risks silent under-payment.
    const missing = lines.filter((l) => !l.accountNo || !IFSC_RE.test(l.ifsc)).map((l) => l.employeeNo);
    if (missing.length > 0) {
      throw new HttpError(422, "BANK_DETAILS_MISSING",
        `missing or invalid bank account/IFSC for: ${missing.join(", ")}`);
    }
    let totalNetMinor = 0n;
    const rows = lines.map((l) => {
      totalNetMinor += l.amountMinor;
      return [
        escapeCsv(l.employeeNo),
        escapeCsv(l.name),
        escapeCsv(l.accountNo),
        escapeCsv(l.ifsc),
        (Number(l.amountMinor) / 100).toFixed(2),
        escapeCsv(`Salary ${run.month} ${l.employeeNo}`),
      ].join(",");
    });
    const header = "Employee No,Name,Bank Account,IFSC,Net Pay Amount,Narration";
    const trailer = `TRAILER,${lines.length},,,${(Number(totalNetMinor) / 100).toFixed(2)},Control total`;
    // Later files of the same run get a -<seq> suffix so every file name (the
    // ledger's file_reference) is distinct.
    const filename = `bank_transfer_${run.runNo}_${run.month}${seq > 1 ? `-${seq}` : ""}.csv`;
    return {
      body: [header, ...rows, trailer].join("\r\n"),
      contentType: "text/csv; charset=utf-8",
      downloadName: filename,
      fileCount: 1,
      lineFileRefs: lines.map(() => filename),
      batchFrom: null,
      batchTo: null,
    };
  };
}

/**
 * NACH credit file(s). Batch numbers start at the run's next unused batch, so
 * every part file name (NACH_<sponsor>_<batch>_<date>.txt) is unique within
 * the run and a return file can name the file it answers.
 */
function nachRenderer(sponsorConfig: SponsorBankConfigRow, settlementDate: string, month: string): Renderer {
  return (lines, { batchBase }): RenderedFile => {
    const beneficiaries: NachBeneficiary[] = lines.map((l: PlannedLine) => ({
      ifsc: l.ifsc,
      accountNo: l.accountNo,
      amountMinor: l.amountMinor,
      name: l.name,
      reference: l.employeeNo,
      narration: `Salary ${month} ${l.employeeNo}`,
    }));
    const validation = validateNachBeneficiaries(beneficiaries);
    if (!validation.valid) {
      const affected = validation.errors.map((e) => e.reference).join(", ");
      throw new HttpError(422, "BANK_DETAILS_MISSING", `missing or invalid bank details for: ${affected}`);
    }
    const result = generateBankFile("nach", sponsorConfig, settlementDate, beneficiaries, batchBase);
    if (!result) throw new HttpError(500, "INTERNAL_ERROR", "unexpected null result from format router");
    if (result.type === "single") {
      return {
        body: result.content,
        contentType: result.contentType,
        downloadName: result.filename,
        fileCount: 1,
        lineFileRefs: lines.map(() => result.filename),
        batchFrom: batchBase,
        batchTo: batchBase,
      };
    }
    // Same split the router used, so line i maps to the part that holds it.
    const batches = splitIntoBatches(beneficiaries, sponsorConfig.maxRecordsPerFile, sponsorConfig.maxAmountPerFileMinor);
    if (batches.length !== result.parts.length) {
      throw new HttpError(500, "INTERNAL_ERROR", "NACH part split does not match the generated files");
    }
    const lineFileRefs: string[] = [];
    batches.forEach((batch, i) => { for (let k = 0; k < batch.length; k++) lineFileRefs.push(result.parts[i]!.filename); });
    return {
      body: createZipBuffer(result.parts),
      contentType: "application/zip",
      downloadName: result.archiveName,
      fileCount: result.parts.length,
      lineFileRefs,
      batchFrom: batchBase,
      batchTo: batchBase + result.parts.length - 1,
    };
  };
}

/**
 * NEFT/RTGS or NACH bank-transfer file for salary disbursement. Beneficiary
 * account, IFSC and name are sourced from the HRMS employee master (via
 * payroll-input) or the pensioner master, keyed by employee id; a
 * control-total trailer covers exactly the lines in the file.
 *
 * Which employees a file carries is decided by the transfer ledger, not by
 * run.status (bank-transfer/issuance.ts): the first file pays every payable
 * slip; later files pay only never-sent employees and queued retries unless
 * an admin asks for an audited full re-issue.
 */
export async function bankTransferRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GAP-PAYROLL-DISBURSEMENT-02: the old reason-less GET is kept registered
   * (so the API drift check doesn't treat it as a silent removal) but no
   * longer generates a file -- a GET would bypass the mandatory reason and
   * audit trail. Callers must use POST with { format, reason }.
   */
  app.get("/v1/payroll/runs/:id/bank-file", async (req) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    throw new HttpError(410, "USE_POST",
      "bank file generation now requires POST /v1/payroll/runs/:id/bank-file with { format, reason }");
  });

  app.post("/v1/payroll/runs/:id/bank-file", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);

    const { id } = pathParamSchema.parse(req.params);
    const body = generateBodySchema.parse(req.body ?? {});
    const { format, reason } = body;
    if (body.fullReissue) requireRole(ctx, FULL_REISSUE_ROLES);

    // Verify the run exists and belongs to this tenant
    const runRows = await scopedRead((tx) => tx.select().from(payrollRuns)
      .where(and(eq(payrollRuns.id, id), eq(payrollRuns.tenantId, ctx.tenantId)))
      .limit(1));
    const run = runRows[0];
    if (!run) throw new HttpError(404, "NOT_FOUND", "payroll run not found");

    // Maker-checker: a payment file only exists for an APPROVED run (API
    // status "completed") or a DISBURSED one (API status "paid"). 409: the
    // request is valid but the run is in the wrong state for it.
    if (run.status !== "approved" && run.status !== "disbursed") {
      throw new HttpError(409, "INVALID_STATE", "bank file can only be generated for approved or disbursed runs");
    }

    let render: Renderer;
    if (format === "nach" || format === "apbs") {
      const sponsorConfig = await findByTenantId(ctx.tenantId);
      if (!sponsorConfig) {
        throw new HttpError(422, "SPONSOR_CONFIG_MISSING", "sponsor bank configuration is required for NACH/APBS file generation");
      }
      // GAP-PAYROLL-DISBURSEMENT-06: honour the sponsor's own NACH switch the
      // same way APBS already was.
      if (format === "nach" && !sponsorConfig.nachEnabled) {
        throw new HttpError(422, "NACH_NOT_ENABLED", "NACH is not enabled for this tenant");
      }
      if (format === "apbs" && !sponsorConfig.apbsEnabled) {
        throw new HttpError(422, "APBS_NOT_ENABLED", "APBS is not enabled for this tenant");
      }
      // APBS requires a validated Aadhaar number AND a destination-bank IIN
      // for every beneficiary (see ApbsBeneficiary in apbs-writer.ts). Neither
      // the HRMS employee master (aadhaar_ref is optional/unvalidated and not
      // exposed by PayrollInputEmployee) nor the pensioner master (no Aadhaar
      // column) can supply either field, and IIN has no source anywhere. The
      // old cast produced beneficiaries missing both and always 500'd; fail
      // clearly instead until Aadhaar/IIN capture exists upstream.
      if (format === "apbs") {
        throw new HttpError(422, "APBS_DATA_UNAVAILABLE",
          "APBS requires an Aadhaar number and destination-bank IIN for every beneficiary, which this system does not currently capture for employees or pensioners. Use the nach or csv format instead.");
      }
      // Holidays: empty for now -- future enhancement.
      render = nachRenderer(sponsorConfig, computeSettlementDate(sponsorConfig.settlementOffsetDays, []), run.month);
    } else {
      render = csvRenderer(run);
    }

    const slips = await scopedRead((tx) => tx.select().from(payrollSlips)
      .where(and(eq(payrollSlips.runId, id), eq(payrollSlips.tenantId, ctx.tenantId))));
    if (slips.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "no salary slips found for this run");
    }
    // Review D3/R5: only slips with a payable status are paid (allow-list in
    // issuance.ts) -- 'held' and 'exception' (negative net) slips are in no
    // file and no ledger row.
    const payableSlips = slips.filter((s) => PAYABLE_SLIP_STATUSES.includes(s.status));
    const excludedSlips: Record<string, number> = {};
    for (const s of slips) if (!PAYABLE_SLIP_STATUSES.includes(s.status)) excludedSlips[s.status] = (excludedSlips[s.status] ?? 0) + 1;
    if (payableSlips.length === 0) {
      throw new HttpError(422, "NO_PAYABLE_SLIPS", "no slip in this run has a payable status (held/exception slips are never paid); nothing can be paid");
    }

    const master = await loadBeneficiaryMaster(ctx.tenantId, run, scopedRead);
    const issued = await issueBankFile({
      ctx,
      run,
      format,
      payableSlips,
      excludedSlips,
      master,
      reason,
      fullReissue: body.fullReissue,
      fullReissueReason: body.fullReissueReason ?? null,
      render,
    });

    return reply
      .header("content-type", issued.file.contentType)
      .header("content-disposition", `attachment; filename="${issued.file.downloadName}"`)
      .header(BANK_FILE_SIGNED_HEADER, "false")
      .header(BANK_FILE_MODE_HEADER, issued.mode)
      .header(BANK_FILE_ISSUANCE_HEADER, issued.issuanceId)
      .send(issued.file.body);
  });
}
