import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { payrollTds, payrollNps } from "../statutory/schema.js";
import { payrollRuns } from "../payroll/schema.js";
import { taxDeclarations } from "../tax/schema.js";
import { buildForm16, parseFy } from "../tax/form16.js";
import { fetchPayrollInput, type PayrollInputEmployee } from "../../shared/hrms-client.js";

const STATUTORY_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
const READER_ROLES = [...STATUTORY_ROLES, "hr_admin", "finance_officer", "employee"];

type Quarter = "Q1" | "Q2" | "Q3" | "Q4";
const QUARTERS: Quarter[] = ["Q1", "Q2", "Q3", "Q4"];

/** Apr–Mar months belonging to a 24Q quarter of the FY starting `startYear`. */
function quarterMonths(startYear: number, q: Quarter): string[] {
  const map: Record<Quarter, Array<[number, number]>> = {
    // [calendar-year-offset (0=start,1=next), month]
    Q1: [[0, 4], [0, 5], [0, 6]],
    Q2: [[0, 7], [0, 8], [0, 9]],
    Q3: [[0, 10], [0, 11], [0, 12]],
    Q4: [[1, 1], [1, 2], [1, 3]],
  };
  return map[q].map(([off, m]) => `${startYear + off}-${String(m).padStart(2, "0")}`);
}

const employerIdentity = () => ({
  name: process.env.EMPLOYER_NAME ?? "<EMPLOYER NAME — configure EMPLOYER_NAME>",
  tan: process.env.EMPLOYER_TAN ?? "<TAN — configure EMPLOYER_TAN>",
  pan: process.env.EMPLOYER_PAN ?? "<PAN — configure EMPLOYER_PAN>",
});

/** Deductee-wise TDS aggregate for a set of months (one row per employee). */
async function deducteeWiseTds(tenantId: string, months: string[]): Promise<Map<string, { tds: number; periods: Set<string> }>> {
  // Restrict to disbursed/approved runs so we only report deposited TDS.
  const runs = await db.select().from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, tenantId), inArray(payrollRuns.month, months)));
  const validRunIds = new Set(runs.filter((r) => r.status === "approved" || r.status === "disbursed").map((r) => r.id));

  const tdsRows = await db.select().from(payrollTds)
    .where(and(eq(payrollTds.tenantId, tenantId), inArray(payrollTds.period, months)));

  const byEmp = new Map<string, { tds: number; periods: Set<string> }>();
  for (const t of tdsRows) {
    if (validRunIds.size > 0 && !validRunIds.has(t.runId)) continue;
    const e = byEmp.get(t.employeeId) ?? { tds: 0, periods: new Set<string>() };
    e.tds += Number(t.tdsMinor) / 100;
    e.periods.add(t.period);
    byEmp.set(t.employeeId, e);
  }
  return byEmp;
}

export async function statutoryReturnsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/payroll/statutory/form24q?fy=2026-27&quarter=Q1[&format=file]
   * Quarterly e-TDS return (salary): deductee-wise TDS + challan summary.
   * Q4 also includes Annexure II (salary detail = Form 16 Part B figures).
   */
  app.get("/v1/payroll/statutory/form24q", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const { fy, quarter, format } = req.query as { fy?: string; quarter?: string; format?: string };
    if (!fy) throw new HttpError(400, "VALIDATION_FAILED", "fy is required (e.g. 2026-27)");
    const q = (quarter ?? "").toUpperCase() as Quarter;
    if (!QUARTERS.includes(q)) throw new HttpError(400, "VALIDATION_FAILED", "quarter must be one of Q1,Q2,Q3,Q4");

    const { startYear, endYear } = parseFy(fy);
    const months = quarterMonths(startYear, q);
    const byEmp = await deducteeWiseTds(ctx.tenantId, months);

    // Employee master for PAN + name.
    let master = new Map<string, PayrollInputEmployee>();
    try {
      const input = await fetchPayrollInput(ctx.tenantId, months[months.length - 1] ?? `${endYear}-03`);
      master = new Map(input.employees.map((e) => [e.id, e]));
    } catch { /* HRMS unavailable — PAN/name blank */ }

    const deductees = [...byEmp.entries()].map(([employeeId, agg]) => {
      const emp = master.get(employeeId);
      const tdsDeducted = Math.round(agg.tds);
      return {
        employeeId,
        pan: emp?.pan ?? "",
        panFlag: emp?.pan ? "" : "PANNOTAVBL",
        name: emp?.fullName ?? "",
        tdsDeductedMinor: Math.round(agg.tds * 100),
        tdsDeducted,
        tdsDeposited: tdsDeducted, // deposited == deducted in this model
        periods: [...agg.periods].sort(),
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const totalTdsDeducted = deductees.reduce((s, d) => s + d.tdsDeducted, 0);

    // Challan summary: one challan per month (TDS deposited for that month),
    // restricted to approved/disbursed runs.
    const challanRuns = await db.select().from(payrollRuns)
      .where(and(eq(payrollRuns.tenantId, ctx.tenantId), inArray(payrollRuns.month, months)));
    const challanValidRunIds = new Set(challanRuns.filter((r) => r.status === "approved" || r.status === "disbursed").map((r) => r.id));
    const challanTdsRows = await db.select().from(payrollTds)
      .where(and(eq(payrollTds.tenantId, ctx.tenantId), inArray(payrollTds.period, months)));
    const challans = months.map((month) => ({
      month,
      tdsDeposited: Math.round(challanTdsRows
        .filter((t) => t.period === month && (challanValidRunIds.size === 0 || challanValidRunIds.has(t.runId)))
        .reduce((s, t) => s + Number(t.tdsMinor) / 100, 0)),
    }));

    // Q4: Annexure II — salary detail per deductee (Form 16 Part B figures).
    let annexureII: Array<Record<string, unknown>> | undefined;
    if (q === "Q4") {
      annexureII = [];
      for (const d of deductees) {
        try {
          const f16 = await buildForm16(ctx.tenantId, d.employeeId, fy);
          annexureII.push({
            employeeId: d.employeeId,
            pan: f16.form16PartA.deductee.pan,
            name: f16.form16PartA.deductee.name,
            ...f16.form16PartB,
          });
        } catch { /* skip employees that cannot be built */ }
      }
    }

    const structured = {
      formType: "24Q",
      fy,
      assessmentYear: `${endYear}-${String((endYear + 1) % 100).padStart(2, "0")}`,
      quarter: q,
      deductor: employerIdentity(),
      deducteeCount: deductees.length,
      deductees,
      challanSummary: challans,
      totalTdsDeducted,
      totalTdsDeposited: challans.reduce((s, c) => s + c.tdsDeposited, 0),
      ...(annexureII ? { annexureII } : {}),
      note: "Verify challan BSR/CIN references against TRACES before filing.",
    };

    if (format !== "file") return reply.send(structured);

    // NSDL/EPFO-style pipe-delimited flat file (RPU-like line records).
    const emp = employerIdentity();
    const lines: string[] = [];
    // File Header (FH)
    lines.push(["FH", "24Q", fy, q, emp.tan, emp.pan, emp.name, deductees.length].join("|"));
    // Challan records (CD): batch, month, deposited amount
    challans.forEach((c, i) => {
      lines.push(["CD", i + 1, c.month, c.tdsDeposited.toFixed(2)].join("|"));
    });
    // Deductee records (DD): challan-linked deductee detail
    deductees.forEach((d, i) => {
      lines.push(["DD", i + 1, d.pan || d.panFlag, d.name, d.tdsDeducted.toFixed(2), d.tdsDeposited.toFixed(2)].join("|"));
    });
    if (annexureII) {
      annexureII.forEach((a, i) => {
        lines.push(["A2", i + 1, String(a.pan ?? ""), String(a.name ?? ""),
          Number(a.grossSalary ?? 0).toFixed(2), Number(a.taxableIncome ?? 0).toFixed(2),
          Number(a.totalTaxLiability ?? 0).toFixed(2)].join("|"));
      });
    }
    // File Trailer (FT)
    lines.push(["FT", lines.length + 1, totalTdsDeducted.toFixed(2)].join("|"));

    const filename = `24Q_${fy.replace("-", "")}_${q}.txt`;
    return reply
      .header("content-type", "text/plain; charset=utf-8")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(lines.join("\r\n"));
  });

  /**
   * GET /v1/payroll/statutory/form12ba?employeeId=X&fy=2026-27
   * Statement of perquisites under Sec 17(2).
   */
  app.get("/v1/payroll/statutory/form12ba", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const { employeeId, fy } = req.query as { employeeId?: string; fy?: string };
    if (!employeeId) throw new HttpError(400, "VALIDATION_FAILED", "employeeId is required");
    if (!fy) throw new HttpError(400, "VALIDATION_FAILED", "fy is required (e.g. 2026-27)");
    const { startYear, endYear } = parseFy(fy);

    const decRows = await db.select().from(taxDeclarations)
      .where(and(eq(taxDeclarations.tenantId, ctx.tenantId), eq(taxDeclarations.employeeId, employeeId), eq(taxDeclarations.fy, fy)))
      .limit(1);
    const dec = decRows[0] ?? null;
    const perqMinor = dec ? Number(dec.perquisitesMinor) : 0;

    let pan = ""; let name = "";
    try {
      const input = await fetchPayrollInput(ctx.tenantId, `${endYear}-03`);
      const emp = input.employees.find((e) => e.id === employeeId);
      pan = emp?.pan ?? ""; name = emp?.fullName ?? "";
    } catch { /* HRMS unavailable */ }

    void startYear;
    return reply.send({
      formType: "12BA",
      fy,
      assessmentYear: `${endYear}-${String((endYear + 1) % 100).padStart(2, "0")}`,
      employer: employerIdentity(),
      employee: { employeeId, pan, name },
      // Single aggregate line; component breakdown can be added when HRMS exposes it.
      perquisites: [
        { sl: 1, nature: "Aggregate value of perquisites u/s 17(2)", valueMinor: perqMinor, value: Math.round(perqMinor / 100) },
      ],
      totalPerquisitesMinor: perqMinor,
      totalPerquisites: Math.round(perqMinor / 100),
      note: "Perquisite value sourced from the employee tax declaration (Sec 17(2)).",
    });
  });

  /**
   * GET /v1/payroll/statutory/nps-scf?month=2026-06[&format=file]
   * NSDL/CRA Subscriber Contribution File (SCF) for NPS-scheme employees.
   * PRAN-wise employee + employer contribution for the month.
   */
  app.get("/v1/payroll/statutory/nps-scf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STATUTORY_ROLES);

    const { month, format } = req.query as { month?: string; format?: string };
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      throw new HttpError(400, "VALIDATION_FAILED", "month query param required in YYYY-MM format");
    }

    const npsRows = await db.select().from(payrollNps)
      .where(and(eq(payrollNps.tenantId, ctx.tenantId), eq(payrollNps.period, month)));
    if (npsRows.length === 0) {
      throw new HttpError(404, "NOT_FOUND", `No NPS records found for period ${month}`);
    }

    let master = new Map<string, PayrollInputEmployee>();
    try {
      const input = await fetchPayrollInput(ctx.tenantId, month);
      master = new Map(input.employees.map((e) => [e.id, e]));
    } catch { /* HRMS unavailable — PRAN/name blank */ }

    // Dedup per employee (multiple slips per FY possible); keep latest record per employee.
    const seen = new Set<string>();
    const subscribers = npsRows
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .filter((r) => (seen.has(r.employeeId) ? false : (seen.add(r.employeeId), true)))
      .map((r) => {
        const emp = master.get(r.employeeId);
        const pran = emp?.pran ?? null;
        const empContrib = Number(r.empContribMinor) / 100;
        const erContrib = Number(r.erContribMinor) / 100;
        return {
          employeeId: r.employeeId,
          pran: pran ?? "",
          pranFlag: pran ? "" : "PRANNOTAVBL",
          name: emp?.fullName ?? "",
          employeeContributionMinor: Number(r.empContribMinor),
          employerContributionMinor: Number(r.erContribMinor),
          employeeContribution: Math.round(empContrib),
          employerContribution: Math.round(erContrib),
          totalContribution: Math.round(empContrib + erContrib),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const totalEmployee = subscribers.reduce((s, x) => s + x.employeeContribution, 0);
    const totalEmployer = subscribers.reduce((s, x) => s + x.employerContribution, 0);

    const structured = {
      fileType: "NPS-SCF",
      month,
      employer: employerIdentity(),
      subscriberCount: subscribers.length,
      subscribers,
      totalEmployeeContribution: totalEmployee,
      totalEmployerContribution: totalEmployer,
      totalContribution: totalEmployee + totalEmployer,
      note: "PRAN sourced from HRMS; PRANNOTAVBL flags missing registrations.",
    };

    if (format !== "file") return reply.send(structured);

    // NSDL CRA SCF-style fixed-record pipe-delimited flat file.
    const lines: string[] = [];
    // Header: record-type | file-type | month | subscriber-count
    lines.push(["H", "SCF", month, subscribers.length].join("|"));
    // Subscriber Contribution Records (SCR)
    subscribers.forEach((s, i) => {
      lines.push(["S", i + 1, s.pran || s.pranFlag, s.name,
        s.employeeContribution.toFixed(2), s.employerContribution.toFixed(2),
        s.totalContribution.toFixed(2)].join("|"));
    });
    // Trailer: record-type | total-records | total-employee | total-employer
    lines.push(["T", subscribers.length, totalEmployee.toFixed(2), totalEmployer.toFixed(2)].join("|"));

    const filename = `NPS_SCF_${month.replace("-", "")}.txt`;
    return reply
      .header("content-type", "text/plain; charset=utf-8")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(lines.join("\r\n"));
  });
}
