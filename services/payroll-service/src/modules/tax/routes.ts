import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError, enforceEmployeeOwnership } from "../../shared/context.js";
import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { payrollSlips, payrollRuns } from "../payroll/schema.js";
import { payrollTds } from "../statutory/schema.js";
import { taxDeclarations } from "./schema.js";
import { buildForm16 } from "./form16.js";
import { computeTax, stdDeduction, UnconfiguredFyError } from "./engine.js";
import { HrmsUnavailableError } from "../../shared/hrms-client.js";

const PAYROLL_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
const READER_ROLES  = [...PAYROLL_ROLES, "hr_admin", "finance_officer", "employee"];

/**
 * Parse FY string like "2025-26" to start/end year.
 * M5: strict — must match ^\d{4}-\d{2}$ AND suffix == (startYear+1)%100.
 */
function parseFy(fy: string): { startYear: number; endYear: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(fy ?? "");
  if (!m) throw new HttpError(400, "VALIDATION_FAILED", "fy must be in format YYYY-YY e.g. 2025-26");
  const startYear = parseInt(m[1]!, 10);
  const suffix = parseInt(m[2]!, 10);
  if (suffix !== (startYear + 1) % 100) {
    throw new HttpError(400, "VALIDATION_FAILED", "fy second component must be (startYear+1) mod 100, e.g. 2025-26");
  }
  return { startYear, endYear: startYear + 1 };
}

/** Get all months for a financial year */
function fyMonths(startYear: number): string[] {
  const months: string[] = [];
  for (let m = 4; m <= 12; m++) months.push(`${startYear}-${String(m).padStart(2, "0")}`);
  for (let m = 1; m <= 3; m++) months.push(`${startYear + 1}-${String(m).padStart(2, "0")}`);
  return months;
}

export async function taxRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/payroll/tax/computation?employeeId=X&fy=2025-26&regime=new
   * Compute annual income tax for an employee under specified regime.
   */
  app.get("/v1/payroll/tax/computation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const { employeeId: reqEmployeeId, fy, regime } = req.query as { employeeId?: string; fy?: string; regime?: string };
    // C1: a self-service employee may only read their OWN computation.
    const employeeId = enforceEmployeeOwnership(ctx, reqEmployeeId);
    if (!fy) throw new HttpError(400, "VALIDATION_FAILED", "fy is required (e.g. 2025-26)");
    const selectedRegime = regime === "old" ? "old" : "new";

    const { startYear } = parseFy(fy);
    const months = fyMonths(startYear);

    // Aggregate annual gross from slips for this employee
    let annualGross = 0;
    let annualBasic = 0;
    let annualPfEmployee = 0;

    for (const month of months) {
      // Find runs for this month
      const runs = await db.select().from(payrollRuns)
        .where(and(eq(payrollRuns.tenantId, ctx.tenantId), eq(payrollRuns.month, month)));

      for (const run of runs) {
        const slips = await db.select().from(payrollSlips)
          .where(and(
            eq(payrollSlips.runId, run.id),
            eq(payrollSlips.employeeId, employeeId),
            eq(payrollSlips.tenantId, ctx.tenantId),
          ));
        for (const slip of slips) {
          annualGross += Number(slip.grossMinor) / 100;
          annualBasic += Number(slip.basicMinor) / 100;
          annualPfEmployee += Number(slip.pfEmployeeMinor) / 100;
        }
      }
    }

    // Fetch declarations for exemptions under old regime
    let exemptions = 0;
    if (selectedRegime === "old") {
      const decRows = await db.select().from(taxDeclarations)
        .where(and(
          eq(taxDeclarations.tenantId, ctx.tenantId),
          eq(taxDeclarations.employeeId, employeeId),
          eq(taxDeclarations.fy, fy),
        ))
        .limit(1);
      const dec = decRows[0] ?? null;
      if (dec) {
        const s80c = Math.min(Number(dec.section80c) / 100, 150000); // 80C cap ₹1.5L
        const s80d = Math.min(Number(dec.section80d) / 100, 50000);  // 80D cap ₹50K
        const hra = Number(dec.hraClaimed) / 100;
        const other = Number(dec.otherDeductions) / 100;
        exemptions = s80c + s80d + hra + other;
      }
      try { exemptions += stdDeduction("old", startYear); }
      catch (err) { if (err instanceof UnconfiguredFyError) throw new HttpError(422, "FY_NOT_CONFIGURED", err.message); throw err; }
    } else {
      try { exemptions = stdDeduction("new", startYear); }
      catch (err) { if (err instanceof UnconfiguredFyError) throw new HttpError(422, "FY_NOT_CONFIGURED", err.message); throw err; }
    }

    // Sec 288A: round taxable income to nearest 10.
    const taxableIncome = Math.round(Math.max(0, annualGross - exemptions) / 10) * 10;
    let r;
    try {
      r = computeTax(taxableIncome, selectedRegime, startYear);
    } catch (err) {
      // P2: an unconfigured FY must FAIL clearly, not silently default to a wrong year.
      if (err instanceof UnconfiguredFyError) {
        throw new HttpError(422, "FY_NOT_CONFIGURED", err.message);
      }
      throw err;
    }

    return reply.send({
      employeeId,
      fy,
      regime: selectedRegime,
      annualGross: Math.round(annualGross),
      exemptions: Math.round(exemptions),
      taxableIncome,
      baseTax: r.baseTax,
      rebate87A: r.rebate,
      surcharge: r.surcharge,
      cess: r.cess,
      totalTax: r.totalTax,
      slabBreakdown: r.slabBreakdown,
    });
  });

  /**
   * GET /v1/payroll/tax/form16?employeeId=X&fy=2025-26
   * Returns Form 16 Part A (deductor/deductee identity + quarterly TDS) and a
   * complete Part B (gross → deductions → taxable → tax → TDS → balance).
   */
  app.get("/v1/payroll/tax/form16", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const { employeeId: reqEmployeeId, fy } = req.query as { employeeId?: string; fy?: string };
    // C1: a self-service employee may only read their OWN Form 16.
    const employeeId = enforceEmployeeOwnership(ctx, reqEmployeeId);
    if (!fy) throw new HttpError(400, "VALIDATION_FAILED", "fy is required (e.g. 2025-26)");
    // M5: reject malformed FY with 400 before reaching the builder (whose parseFy
    // throws a plain Error that would otherwise surface as 500).
    parseFy(fy);

    try {
      return reply.send(await buildForm16(ctx.tenantId, employeeId, fy));
    } catch (err) {
      // M4: HRMS unreachable → 502 (do not emit a blank-identity Form 16).
      if (err instanceof HrmsUnavailableError) {
        throw new HttpError(502, "HRMS_UNAVAILABLE", "cannot issue Form 16: HRMS identity source unreachable");
      }
      if (err instanceof UnconfiguredFyError) {
        throw new HttpError(422, "FY_NOT_CONFIGURED", err.message);
      }
      throw err;
    }
  });

  /**
   * POST /v1/payroll/tax/declarations
   * Employee submits 80C/80D/HRA proof declarations.
   */
  app.post("/v1/payroll/tax/declarations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...READER_ROLES]);

    const body = req.body as {
      employeeId?: string;
      fy?: string;
      regime?: string;
      section80c?: number;
      section80d?: number;
      hraClaimed?: number;
      rentPaid?: number;
      otherDeductions?: number;
      prevEmployerSalary?: number;
      prevEmployerTds?: number;
      otherSourcesIncome?: number;
      perquisites?: number;
    };

    // C2: a self-service employee may only file a declaration for THEMSELVES.
    const employeeId = enforceEmployeeOwnership(ctx, body.employeeId);
    if (!body.fy) throw new HttpError(400, "VALIDATION_FAILED", "fy is required");

    const regime = body.regime === "old" ? "old" : "new";

    const paise = (v?: number): bigint => BigInt(Math.round((v ?? 0) * 100));
    const fields = {
      regime,
      section80c: paise(body.section80c),
      section80d: paise(body.section80d),
      hraClaimed: paise(body.hraClaimed),
      rentPaidMinor: paise(body.rentPaid),
      otherDeductions: paise(body.otherDeductions),
      prevEmployerSalaryMinor: paise(body.prevEmployerSalary),
      prevEmployerTdsMinor: paise(body.prevEmployerTds),
      otherSourcesIncomeMinor: paise(body.otherSourcesIncome),
      perquisitesMinor: paise(body.perquisites),
    };

    // Upsert declaration
    await db.insert(taxDeclarations).values({
      tenantId: ctx.tenantId,
      employeeId,
      fy: body.fy,
      ...fields,
      status: "submitted",
      createdBy: ctx.actorId,
    }).onConflictDoUpdate({
      target: [taxDeclarations.tenantId, taxDeclarations.employeeId, taxDeclarations.fy],
      set: { ...fields, status: "submitted" },
    });

    return reply.code(201).send({ message: "declaration saved", employeeId, fy: body.fy, regime });
  });
}
