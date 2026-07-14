import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { eq, and, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { payrollSlips, payrollRuns } from "../payroll/schema.js";
import { fetchPayrollInput } from "../../shared/hrms-client.js";
import { findByTenantId } from "../sponsor-config/repo.js";
import { validateNachBeneficiaries, computeSettlementDate } from "./domain.js";
import type { NachBeneficiary } from "./domain.js";
import { generateBankFile, type BankFileFormat } from "./format-router.js";
import { createZipBuffer } from "./zip-util.js";

const PAYROLL_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
const AUDIT_TOPIC = "audit.event.record";

const pathParamSchema = z.object({
  id: z.string().uuid(),
});

const querySchema = z.object({
  format: z.enum(["csv", "nach", "apbs"]).default("csv"),
});

/**
 * NEFT/RTGS bank-transfer file for salary disbursement. Beneficiary account,
 * IFSC and name are sourced from the HRMS employee master (via payroll-input),
 * keyed by employee id; a control-total trailer (record count + total net) is
 * appended so the bank can reconcile the batch before processing.
 */
export async function bankTransferRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/runs/:id/bank-file", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);

    const { id } = pathParamSchema.parse(req.params);
    const { format } = querySchema.parse(req.query);

    // Verify the run exists and belongs to this tenant
    const runRows = await scopedRead((tx) => tx.select().from(payrollRuns)
      .where(and(eq(payrollRuns.id, id), eq(payrollRuns.tenantId, ctx.tenantId)))
      .limit(1));
    const run = runRows[0];
    if (!run) throw new HttpError(404, "NOT_FOUND", "payroll run not found");

    if (run.status !== "approved" && run.status !== "disbursed") {
      throw new HttpError(400, "INVALID_STATE", "bank file can only be generated for approved or disbursed runs");
    }

    // ─── NACH / APBS path ────────────────────────────────────────────────
    if (format === "nach" || format === "apbs") {
      // Load sponsor bank config
      const sponsorConfig = await findByTenantId(ctx.tenantId);
      if (!sponsorConfig) {
        throw new HttpError(422, "SPONSOR_CONFIG_MISSING", "sponsor bank configuration is required for NACH/APBS file generation");
      }

      // APBS-specific check
      if (format === "apbs" && !sponsorConfig.apbsEnabled) {
        throw new HttpError(422, "APBS_NOT_ENABLED", "APBS is not enabled for this tenant");
      }

      // Fetch all slips for this run
      const slips = await scopedRead((tx) => tx.select().from(payrollSlips)
        .where(and(eq(payrollSlips.runId, id), eq(payrollSlips.tenantId, ctx.tenantId))));

      if (slips.length === 0) {
        throw new HttpError(404, "NOT_FOUND", "no salary slips found for this run");
      }

      // Load beneficiary master (same as CSV path)
      type Beneficiary = { fullName: string; bankAccountNo: string | null; bankIfsc: string | null };
      const master = new Map<string, Beneficiary>();
      if (run.runType === "pensioner") {
        const pens = (await scopedRead((tx) => tx.execute(sql`
          SELECT id, full_name, bank_account_no, bank_ifsc
          FROM payroll.payroll_pensioners
          WHERE tenant_id = ${ctx.tenantId}::uuid
        `))) as unknown as Array<{ id: string; full_name: string; bank_account_no: string | null; bank_ifsc: string | null }>;
        for (const p of pens) master.set(p.id, { fullName: p.full_name, bankAccountNo: p.bank_account_no, bankIfsc: p.bank_ifsc });
      } else {
        const input = await fetchPayrollInput(ctx.tenantId, run.month);
        for (const e of input.employees) master.set(e.id, { fullName: e.fullName, bankAccountNo: e.bankAccountNo, bankIfsc: e.bankIfsc });
      }

      // Convert slips + master into NachBeneficiary[]
      const beneficiaries: NachBeneficiary[] = slips.map((slip) => {
        const emp = master.get(slip.employeeId);
        return {
          ifsc: (emp?.bankIfsc ?? "").trim().toUpperCase(),
          accountNo: (emp?.bankAccountNo ?? "").trim(),
          amountMinor: slip.netPayMinor,
          name: emp?.fullName ?? slip.employeeNo,
          reference: slip.employeeNo,
          narration: `Salary ${run.month} ${slip.employeeNo}`,
        };
      });

      // Validate beneficiaries for NACH format
      if (format === "nach") {
        const validation = validateNachBeneficiaries(beneficiaries);
        if (!validation.valid) {
          const affected = validation.errors.map((e) => e.reference).join(", ");
          throw new HttpError(422, "BANK_DETAILS_MISSING",
            `missing or invalid bank details for: ${affected}`);
        }
      }

      // Compute settlement date (holidays: empty for now — future enhancement)
      const settlementDate = computeSettlementDate(sponsorConfig.settlementOffsetDays, []);

      // Generate file(s)
      const result = generateBankFile(
        format as BankFileFormat,
        sponsorConfig,
        settlementDate,
        beneficiaries,
        1, // batchNumber starts at 1
      );

      if (!result) {
        throw new HttpError(500, "INTERNAL_ERROR", "unexpected null result from format router");
      }

      // Compute totals for audit
      let totalAmountMinor = 0n;
      for (const b of beneficiaries) totalAmountMinor += b.amountMinor;

      // Emit audit event
      await db.transaction(async (tx) => {
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          correlationId: ctx.correlationId,
          payload: {
            service: "payroll",
            action: "bank_file_generated",
            resourceType: "payroll_run",
            resourceId: id,
            outcome: "success",
            detail: {
              format,
              recordCount: beneficiaries.length,
              totalAmountMinor: totalAmountMinor.toString(),
              fileCount: result.type === "multi" ? result.parts.length : 1,
            },
          },
        });
      });

      if (result.type === "single") {
        return reply
          .header("content-type", result.contentType)
          .header("content-disposition", `attachment; filename="${result.filename}"`)
          .send(result.content);
      }

      // Multiple files — create ZIP archive
      const zipBuffer = createZipBuffer(result.parts);
      return reply
        .header("content-type", "application/zip")
        .header("content-disposition", `attachment; filename="${result.archiveName}"`)
        .send(zipBuffer);
    }

    // ─── CSV path (existing, unchanged) ──────────────────────────────────
    // Fetch all slips for this run
    const slips = await scopedRead((tx) => tx.select().from(payrollSlips)
      .where(and(eq(payrollSlips.runId, id), eq(payrollSlips.tenantId, ctx.tenantId))));

    if (slips.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "no salary slips found for this run");
    }

    // Beneficiary bank details. Salary runs source the HRMS employee master;
    // pensioner runs source the pensioner master (keyed by pensioner id, which
    // is the slip's employeeId). Both expose { fullName, bankAccountNo, bankIfsc }.
    type Beneficiary = { fullName: string; bankAccountNo: string | null; bankIfsc: string | null };
    const master = new Map<string, Beneficiary>();
    if (run.runType === "pensioner") {
      const pens = (await scopedRead((tx) => tx.execute(sql`
        SELECT id, full_name, bank_account_no, bank_ifsc
        FROM payroll.payroll_pensioners
        WHERE tenant_id = ${ctx.tenantId}::uuid
      `))) as unknown as Array<{ id: string; full_name: string; bank_account_no: string | null; bank_ifsc: string | null }>;
      for (const p of pens) master.set(p.id, { fullName: p.full_name, bankAccountNo: p.bank_account_no, bankIfsc: p.bank_ifsc });
    } else {
      const input = await fetchPayrollInput(ctx.tenantId, run.month);
      for (const e of input.employees) master.set(e.id, { fullName: e.fullName, bankAccountNo: e.bankAccountNo, bankIfsc: e.bankIfsc });
    }

    // H4: CSV injection + delimiter safety. Neutralise spreadsheet formula
    // triggers (= + - @, and TAB/CR which Excel also treats as leading) by
    // prefixing with a single quote, then quote/escape per RFC 4180 if the
    // value contains a comma, quote, CR or LF.
    const escapeCsv = (raw: string): string => {
      let val = raw ?? "";
      if (/^[=+\-@\t\r]/.test(val)) val = `'${val}`;
      if (/[",\r\n]/.test(val)) val = `"${val.replace(/"/g, '""')}"`;
      return val;
    };
    const ifscRe = /^[A-Z]{4}0[A-Z0-9]{6}$/; // RBI IFSC format
    const missing: string[] = [];
    let totalNetMinor = 0n;

    const csvRows = slips.map((slip) => {
      const emp = master.get(slip.employeeId);
      const bankAccount = (emp?.bankAccountNo ?? "").trim();
      const ifsc = (emp?.bankIfsc ?? "").trim().toUpperCase();
      const name = emp?.fullName ?? slip.employeeNo;
      if (!bankAccount || !ifscRe.test(ifsc)) missing.push(slip.employeeNo);
      totalNetMinor += slip.netPayMinor;

      const netPay = (Number(slip.netPayMinor) / 100).toFixed(2);
      const narration = `Salary ${run.month} ${slip.employeeNo}`;
      return [
        escapeCsv(slip.employeeNo),
        escapeCsv(name),
        escapeCsv(bankAccount),
        escapeCsv(ifsc),
        netPay,
        escapeCsv(narration),
      ].join(",");
    });

    // Refuse to emit a file with unusable beneficiary rows — the bank would
    // reject the whole batch, and a partial file risks silent under-payment.
    if (missing.length > 0) {
      throw new HttpError(422, "BANK_DETAILS_MISSING",
        `missing or invalid bank account/IFSC for: ${missing.join(", ")}`);
    }

    const csvHeader = "Employee No,Name,Bank Account,IFSC,Net Pay Amount,Narration";
    const trailer = `TRAILER,${slips.length},,,${(Number(totalNetMinor) / 100).toFixed(2)},Control total`;
    const csvContent = [csvHeader, ...csvRows, trailer].join("\r\n");
    const filename = `bank_transfer_${run.runNo}_${run.month}.csv`;

    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(csvContent);
  });
}
