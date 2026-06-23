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

const NEW_REGIME_SLABS: TaxSlab[] = [
  { from: 0,       to: 300000,  rate: 0 },
  { from: 300000,  to: 700000,  rate: 0.05 },
  { from: 700000,  to: 1000000, rate: 0.10 },
  { from: 1000000, to: 1200000, rate: 0.15 },
  { from: 1200000, to: 1500000, rate: 0.20 },
  { from: 1500000, to: Infinity, rate: 0.30 },
];

const OLD_REGIME_SLABS: TaxSlab[] = [
  { from: 0,       to: 250000,  rate: 0 },
  { from: 250000,  to: 500000,  rate: 0.05 },
  { from: 500000,  to: 1000000, rate: 0.20 },
  { from: 1000000, to: Infinity, rate: 0.30 },
];

function computeTax(taxableIncome: number, slabs: TaxSlab[]): { tax: number; slabBreakdown: Array<{ slab: string; taxableAmount: number; tax: number }> } {
  let remaining = taxableIncome;
  let totalTax = 0;
  const slabBreakdown: Array<{ slab: string; taxableAmount: number; tax: number }> = [];

  for (const slab of slabs) {
    if (remaining <= 0) break;
    const slabWidth = slab.to === Infinity ? remaining : slab.to - slab.from;
    const taxableInSlab = Math.min(remaining, slabWidth);
    const taxInSlab = Math.round(taxableInSlab * slab.rate);
    totalTax += taxInSlab;
    slabBreakdown.push({
      slab: slab.to === Infinity ? `>${(slab.from / 100000).toFixed(1)}L` : `${(slab.from / 100000).toFixed(1)}L-${(slab.to / 100000).toFixed(1)}L`,
      taxableAmount: taxableInSlab,
      tax: taxInSlab,
    });
    remaining -= taxableInSlab;
  }

  // Add 4% health & education cess
  const cess = Math.round(totalTax * 0.04);
  totalTax += cess;

  return { tax: totalTax, slabBreakdown };
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
      // Standard deduction ₹50,000
      exemptions += 50000;
    } else {
      // New regime standard deduction ₹75,000 (FY 2025-26)
      exemptions = 75000;
    }

    const taxableIncome = Math.max(0, annualGross - exemptions);
    const slabs = selectedRegime === "new" ? NEW_REGIME_SLABS : OLD_REGIME_SLABS;
    const { tax, slabBreakdown } = computeTax(taxableIncome, slabs);

    return reply.send({
      employeeId,
      fy,
      regime: selectedRegime,
      annualGross: Math.round(annualGross),
      exemptions: Math.round(exemptions),
      taxableIncome: Math.round(taxableIncome),
      totalTax: tax,
      cessIncluded: Math.round(tax - slabBreakdown.reduce((s, b) => s + b.tax, 0)),
      slabBreakdown,
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
        otherDeductions: BigInt(Math.round((body.otherDeductions ?? 0) * 100)),
        status: "submitted",
      },
    });

    return reply.code(201).send({ message: "declaration saved", employeeId: body.employeeId, fy: body.fy, regime });
  });
}
