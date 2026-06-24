import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { payrollPf } from "./schema.js";
import { payrollSlips } from "../payroll/schema.js";
import { fetchPayrollInput } from "../../shared/hrms-client.js";

const STATUTORY_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];

/**
 * EPFO ECR (Electronic Challan cum Return) file generation.
 * Format: pipe-delimited text file as per EPFO specification.
 * Columns: UAN|Member Name|Gross Wages|EPF Wages|EPS Wages|EDLI Wages|
 *          EPF Contribution(EE)|EPS Contribution(ER)|EPF Contribution(ER)|NCP Days|Refund of Advances
 *
 * UAN and member name are sourced from the HRMS employee master; the employer
 * EPS/EPF split is read from the persisted PF record (computed at run time with
 * the Rs 1,250 EPS cap) rather than re-derived here.
 */
export async function ecrRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/statutory/ecr", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STATUTORY_ROLES);

    const { month } = req.query as { month?: string };
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      throw new HttpError(400, "VALIDATION_FAILED", "month query param required in YYYY-MM format");
    }

    // Fetch PF records for the given period
    const pfRecords = await db.select().from(payrollPf)
      .where(and(eq(payrollPf.tenantId, ctx.tenantId), eq(payrollPf.period, month)));

    if (pfRecords.length === 0) {
      throw new HttpError(404, "NOT_FOUND", `No PF records found for period ${month}`);
    }

    // Employee master (UAN + name), keyed by employee id.
    const input = await fetchPayrollInput(ctx.tenantId, month);
    const master = new Map(input.employees.map((e) => [e.id, e]));

    const lines: string[] = [];
    for (const pf of pfRecords) {
      const slipRows = await db.select().from(payrollSlips)
        .where(and(eq(payrollSlips.id, pf.slipId), eq(payrollSlips.tenantId, ctx.tenantId)))
        .limit(1);
      const slip = slipRows[0];
      const emp = master.get(pf.employeeId);

      const grossWages = slip ? Math.round(Number(slip.grossMinor) / 100) : 0;
      const basicWages = slip ? Math.round(Number(slip.basicMinor) / 100) : 0;
      // EPF/EPS/EDLI wages are pensionable wages capped at the Rs 15,000 ceiling.
      const epfWages = Math.min(basicWages, 15000);
      const epsWages = Math.min(basicWages, 15000);
      const edliWages = Math.min(basicWages, 15000);

      const epfEE = Math.round(Number(pf.empContribMinor) / 100);          // Employee 12%
      // Employer split from the persisted record (EPS capped at Rs 1,250).
      const epsER = Math.round(Number(pf.epsContribMinor) / 100);
      const epfER = Math.round(Number(pf.epfErContribMinor) / 100);
      const ncpDays = 0;
      const refundAdvances = 0;

      // H4: pipe-delimited flat file — strip the field separator and CR/LF from
      // free-text fields so a crafted name/UAN cannot inject or misalign records.
      const pipeSafe = (v: string): string => (v ?? "").replace(/[|\r\n]/g, " ").trim();
      const uan = pipeSafe(emp?.uan ?? "");
      const memberName = pipeSafe(emp?.fullName ?? slip?.employeeNo ?? "");
      const line = [
        uan,
        memberName,
        grossWages,
        epfWages,
        epsWages,
        edliWages,
        epfEE,
        epsER,
        epfER,
        ncpDays,
        refundAdvances,
      ].join("|");
      lines.push(line);
    }

    const ecrContent = lines.join("\r\n");
    const filename = `ECR_${month.replace("-", "")}.txt`;

    return reply
      .header("content-type", "text/plain; charset=utf-8")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(ecrContent);
  });
}
