import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { payrollSlips, payrollRuns } from "../payroll/schema.js";
import { payrollTds } from "../statutory/schema.js";
import { taxDeclarations } from "./schema.js";

const PAYROLL_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
const READER_ROLES  = [...PAYROLL_ROLES, "hr_admin", "finance_officer", "employee"];

/* ---------- Tax Slab Computation ---------- */

interface TaxSlab { from: number; to: number; rate: number }

// New regime slabs differ by financial year (Finance Act changes).
const NEW_REGIME_BY_FY: Record<number, TaxSlab[]> = {
  2024: [ // FY 2024-25
    { from: 0, to: 300000, rate: 0 }, { from: 300000, to: 700000, rate: 0.05 },
    { from: 700000, to: 1000000, rate: 0.10 }, { from: 1000000, to: 1200000, rate: 0.15 },
    { from: 1200000, to: 1500000, rate: 0.20 }, { from: 1500000, to: Infinity, rate: 0.30 },
  ],
  2025: [ // FY 2025-26 (Finance Act 2025)
    { from: 0, to: 400000, rate: 0 }, { from: 400000, to: 800000, rate: 0.05 },
    { from: 800000, to: 1200000, rate: 0.10 }, { from: 1200000, to: 1600000, rate: 0.15 },
    { from: 1600000, to: 2000000, rate: 0.20 }, { from: 2000000, to: 2400000, rate: 0.25 },
    { from: 2400000, to: Infinity, rate: 0.30 },
  ],
};

const OLD_REGIME_SLABS: TaxSlab[] = [
  { from: 0, to: 250000, rate: 0 }, { from: 250000, to: 500000, rate: 0.05 },
  { from: 500000, to: 1000000, rate: 0.20 }, { from: 1000000, to: Infinity, rate: 0.30 },
];

function slabsFor(regime: "old" | "new", startYear: number): TaxSlab[] {
  if (regime === "old") return OLD_REGIME_SLABS;
  return NEW_REGIME_BY_FY[startYear] ?? NEW_REGIME_BY_FY[2025] ?? OLD_REGIME_SLABS;
}

function slabTax(taxableIncome: number, slabs: TaxSlab[]): { tax: number; breakdown: Array<{ slab: string; taxableAmount: number; tax: number }> } {
  let remaining = taxableIncome, total = 0;
  const breakdown: Array<{ slab: string; taxableAmount: number; tax: number }> = [];
  let lower = 0;
  for (const s of slabs) {
    if (remaining <= 0) break;
    const width = s.to === Infinity ? remaining : s.to - s.from;
    const inSlab = Math.min(remaining, width);
    const t = inSlab * s.rate;
    total += t;
    breakdown.push({ slab: s.to === Infinity ? `>${(s.from / 100000).toFixed(0)}L` : `${(s.from / 100000).toFixed(1)}L-${(s.to / 100000).toFixed(1)}L`, taxableAmount: inSlab, tax: Math.round(t) });
    remaining -= inSlab; lower = s.to;
  }
  void lower;
  return { tax: total, breakdown };
}

/** Sec 87A rebate ceiling by regime + FY (rebate makes tax 0 up to the income limit). */
function rebate87A(taxableIncome: number, slabTaxAmt: number, regime: "old" | "new", startYear: number): number {
  if (regime === "old") return taxableIncome <= 500000 ? Math.min(slabTaxAmt, 12500) : 0;
  if (startYear >= 2025) return taxableIncome <= 1200000 ? Math.min(slabTaxAmt, 60000) : 0;
  return taxableIncome <= 700000 ? Math.min(slabTaxAmt, 25000) : 0; // FY24-25 new
}

/** Surcharge rate by total income, with new-regime cap of 25%. */
function surchargeRate(totalIncome: number, regime: "old" | "new"): number {
  if (totalIncome <= 5000000) return 0;
  if (totalIncome <= 10000000) return 0.10;
  if (totalIncome <= 20000000) return 0.15;
  if (totalIncome <= 50000000) return 0.25;
  return regime === "new" ? 0.25 : 0.37;
}

/** Full income-tax computation: slabs -> 87A rebate -> surcharge(+marginal relief) -> 4% cess; 288B rounding. */
function computeTax(taxableIncome: number, regime: "old" | "new", startYear: number) {
  const slabs = slabsFor(regime, startYear);
  const { tax: rawSlab, breakdown } = slabTax(taxableIncome, slabs);
  const baseTax = Math.round(rawSlab);
  const rebate = rebate87A(taxableIncome, baseTax, regime, startYear);
  const afterRebate = Math.max(0, baseTax - rebate);
  let surcharge = Math.round(afterRebate * surchargeRate(taxableIncome, regime));
  // Marginal relief: surcharge cannot make (tax+surcharge) exceed tax-at-threshold + (income-threshold).
  const thresholds = [5000000, 10000000, 20000000, 50000000];
  for (const th of thresholds) {
    if (taxableIncome > th) {
      const slabAtTh = Math.round(slabTax(th, slabs).tax);
      const excess = taxableIncome - th;
      if (afterRebate + surcharge > slabAtTh + excess) surcharge = Math.max(0, slabAtTh + excess - afterRebate);
    }
  }
  const cess = Math.round((afterRebate + surcharge) * 0.04);
  const total = Math.round((afterRebate + surcharge + cess) / 10) * 10; // Sec 288B nearest 10
  return { baseTax, rebate, surcharge, cess, totalTax: total, slabBreakdown: breakdown };
}

/** Parse FY string like "2025-26" to start/end year */
function parseFy(fy: string): { startYear: number; endYear: number } {
  const parts = fy.split("-");
  if (parts.length !== 2 || !parts[0]) throw new HttpError(400, "VALIDATION_FAILED", "fy must be in format YYYY-YY e.g. 2025-26");
  const startYear = parseInt(parts[0], 10);
  const endYear = startYear + 1;
  return { startYear, endYear };
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

    const { employeeId, fy, regime } = req.query as { employeeId?: string; fy?: string; regime?: string };
    if (!employeeId) throw new HttpError(400, "VALIDATION_FAILED", "employeeId is required");
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
      exemptions += 50000; // old-regime standard deduction
    } else {
      exemptions = 75000;  // new-regime standard deduction (FY24-25 onward)
    }

    // Sec 288A: round taxable income to nearest 10.
    const taxableIncome = Math.round(Math.max(0, annualGross - exemptions) / 10) * 10;
    const r = computeTax(taxableIncome, selectedRegime, startYear);

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
   * Returns Form 16 Part B structured data.
   */
  app.get("/v1/payroll/tax/form16", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const { employeeId, fy } = req.query as { employeeId?: string; fy?: string };
    if (!employeeId) throw new HttpError(400, "VALIDATION_FAILED", "employeeId is required");
    if (!fy) throw new HttpError(400, "VALIDATION_FAILED", "fy is required (e.g. 2025-26)");

    const { startYear } = parseFy(fy);
    const months = fyMonths(startYear);

    // Aggregate TDS deducted during the year
    let totalTdsDeducted = 0;
    let annualGross = 0;
    let annualBasic = 0;

    for (const month of months) {
      const tdsRows = await db.select().from(payrollTds)
        .where(and(
          eq(payrollTds.tenantId, ctx.tenantId),
          eq(payrollTds.employeeId, employeeId),
          eq(payrollTds.period, month),
        ));
      for (const t of tdsRows) {
        totalTdsDeducted += Number(t.tdsMinor) / 100;
        annualGross += Number(t.annualBasicMinor) / 100;
      }
    }

    // Fetch declarations
    const decRows = await db.select().from(taxDeclarations)
      .where(and(
        eq(taxDeclarations.tenantId, ctx.tenantId),
        eq(taxDeclarations.employeeId, employeeId),
        eq(taxDeclarations.fy, fy),
      ))
      .limit(1);
    const dec = decRows[0] ?? null;

    return reply.send({
      employeeId,
      fy,
      form16PartB: {
        grossSalary: Math.round(annualGross),
        standardDeduction: 50000,
        section80c: dec ? Math.min(Number(dec.section80c) / 100, 150000) : 0,
        section80d: dec ? Math.min(Number(dec.section80d) / 100, 50000) : 0,
        hraClaimed: dec ? Number(dec.hraClaimed) / 100 : 0,
        otherDeductions: dec ? Number(dec.otherDeductions) / 100 : 0,
        totalTdsDeducted: Math.round(totalTdsDeducted),
        regime: dec?.regime ?? "new",
      },
    });
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
    };

    if (!body.employeeId) throw new HttpError(400, "VALIDATION_FAILED", "employeeId is required");
    if (!body.fy) throw new HttpError(400, "VALIDATION_FAILED", "fy is required");

    const regime = body.regime === "old" ? "old" : "new";

    // Upsert declaration
    await db.insert(taxDeclarations).values({
      tenantId: ctx.tenantId,
      employeeId: body.employeeId,
      fy: body.fy,
      regime,
      section80c: BigInt(Math.round((body.section80c ?? 0) * 100)),
      section80d: BigInt(Math.round((body.section80d ?? 0) * 100)),
      hraClaimed: BigInt(Math.round((body.hraClaimed ?? 0) * 100)),
      rentPaidMinor: BigInt(Math.round((body.rentPaid ?? 0) * 100)),
      otherDeductions: BigInt(Math.round((body.otherDeductions ?? 0) * 100)),
      status: "submitted",
      createdBy: ctx.actorId,
    }).onConflictDoUpdate({
      target: [taxDeclarations.tenantId, taxDeclarations.employeeId, taxDeclarations.fy],
      set: {
        regime,
        section80c: BigInt(Math.round((body.section80c ?? 0) * 100)),
        section80d: BigInt(Math.round((body.section80d ?? 0) * 100)),
        hraClaimed: BigInt(Math.round((body.hraClaimed ?? 0) * 100)),
        rentPaidMinor: BigInt(Math.round((body.rentPaid ?? 0) * 100)),
        otherDeductions: BigInt(Math.round((body.otherDeductions ?? 0) * 100)),
        status: "submitted",
      },
    });

    return reply.code(201).send({ message: "declaration saved", employeeId: body.employeeId, fy: body.fy, regime });
  });
}
