import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { payrollPf } from "./schema.js";
import { payrollSlips, payrollRuns } from "../payroll/schema.js";

const STATUTORY_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];

/**
 * EPFO ECR (Electronic Challan cum Return) file generation.
 * Format: pipe-delimited text file as per EPFO specification.
 * Columns: UAN|Member Name|Gross Wages|EPF Wages|EPS Wages|EDLI Wages|EPF Contribution(EE)|EPS Contribution(ER)|EPF Contribution(ER)|NCP Days|Refund of Advances
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

    // For each PF record, get the slip to access employee info and gross wages
    const lines: string[] = [];
    for (const pf of pfRecords) {
      const slipRows = await db.select().from(payrollSlips)
        .where(and(eq(payrollSlips.id, pf.slipId), eq(payrollSlips.tenantId, ctx.tenantId)))
        .limit(1);
      const slip = slipRows[0];

      const grossWages = slip ? Math.round(Number(slip.grossMinor) / 100) : 0;
      const basicWages = slip ? Math.round(Number(slip.basicMinor) / 100) : 0;
      const epfWages = basicWages; // EPF wages = basic (capped at 15000 by employer in practice)
      const epsWages = Math.min(basicWages, 15000); // EPS capped at ₹15,000
      const edliWages = Math.min(basicWages, 15000); // EDLI capped at ₹15,000
      const epfEE = Math.round(Number(pf.empContribMinor) / 100); // Employee 12%
      const epsER = Math.round(epsWages * 0.0833); // 8.33% of EPS wages
      const epfER = epfEE - epsER; // Remaining ER contribution to EPF
      const ncpDays = 0;
      const refundAdvances = 0;

      // UAN|Member Name|Gross Wages|EPF Wages|EPS Wages|EDLI Wages|EPF(EE)|EPS(ER)|EPF(ER)|NCP Days|Refund
      const memberName = slip?.employeeNo ?? "";
      const line = [
        "", // UAN — would come from employee master
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
