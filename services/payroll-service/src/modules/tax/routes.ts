import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError, enforceEmployeeOwnership, isSelfServiceEmployee } from "../../shared/context.js";
import { eq, and, inArray } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { payrollSlips, payrollRuns } from "../payroll/schema.js";
import { payrollTds } from "../statutory/schema.js";
import { taxDeclarations } from "./schema.js";
import { exemptionCeilings } from "../fnf/schema.js";
import { buildForm16 } from "./form16.js";
import { computeTax, stdDeduction, UnconfiguredFyError } from "./engine.js";
import { resolveRunStatutoryConfig } from "../payroll/consumer.js";
import { HrmsUnavailableError, fetchPayrollInput } from "../../shared/hrms-client.js";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { createTaxDeclarationBody } from "./validators.js";
import * as commands from "./commands.js";

const PAYROLL_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
const READER_ROLES  = [...PAYROLL_ROLES, "hr_admin", "finance_officer", "employee"];
const WRITER_ROLES  = [...PAYROLL_ROLES, "employee", "hr_admin"];
const CEILING_ROLES = ["payroll_admin", "super_admin"];

const VALID_SECTIONS = ["10_10", "10_10AA", "10_10B", "10_10C"] as const;

const upsertCeilingBody = z.object({
  fyStartYear: z.number().int().min(2020).max(2099),
  section: z.enum(VALID_SECTIONS),
  ceilingMinor: z.string().transform((v) => BigInt(v)),
  notes: z.string().max(512).optional(),
});

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

/** India's FY runs Apr–Mar; returns the FY string (e.g. "2026-27") containing today. */
function currentFy(): string {
  const now = new Date();
  const startYear = now.getUTCMonth() + 1 >= 4 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/**
 * DOM-020: this route independently hardcoded the Sec 80D cap at Rs 50,000
 * in two places, disagreeing with DOM-008's config-driven `sec80dCapMinor`
 * (domain.ts, platform default Rs 75,000) -- a tenant's override via the
 * statutory_config table was honored in payroll TDS but silently ignored
 * here. Resolve the same effective-dated config domain.ts uses instead of a
 * literal. FY-scoped (not run-scoped), so resolve as of the FY's last month
 * (March of startYear+1), matching this file's other FY-snapshot reads.
 */
async function resolveSec80dCapRupees(tenantId: string, startYear: number): Promise<number> {
  // Must run through scopedRead() -- the wrapped-transaction helper that is
  // the only place this service's tenant-GUC wrapper (packages/db) sets the
  // RLS session variable from the request-scoped AsyncLocalStorage context
  // (see this file's own scopedRead() calls above, and shared/db.ts's doc
  // comment). Resolving the config on a bare, unscoped connection runs with
  // no tenant GUC set, so the tenant-isolation policy fails closed and only
  // the platform-default sentinel row is visible -- silently reintroducing
  // the exact bug this fix closes. Using the transaction API directly here
  // (instead of this existing wrapper) would also trip this service's own
  // CQRS route-boundary guard (f3-leftover-payroll-cqrs.test.ts), which is
  // exactly why every read in this file, this one included, goes through
  // scopedRead() rather than opening one itself.
  const cfg = await scopedRead((tx) => resolveRunStatutoryConfig(tx, tenantId, `${startYear + 1}-03`));
  return Number(cfg.sec80dCapMinor) / 100;
}

export async function taxRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/payroll/income-tax?fy=2025-26&employeeId=X
   * FY income-tax rollup across employees who have payroll slips and/or a
   * declaration on file for the FY (defaults to the current FY). Self-service
   * employees only ever see their own row. Unlike Form 16, this is a summary
   * listing — an unreachable HRMS degrades to id-only identities (honest
   * shaped, `meta.hrmsAvailable: false`) rather than failing the whole page.
   */
  app.get("/v1/payroll/income-tax", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const { fy: reqFy, employeeId: reqEmployeeId } = req.query as { fy?: string; employeeId?: string };
    const fy = reqFy ?? currentFy();
    parseFy(fy);
    const { startYear } = parseFy(fy);
    const months = fyMonths(startYear);
    const scopedEmployeeId = isSelfServiceEmployee(ctx) ? ctx.actorId : (reqEmployeeId ?? null);

    const runs = await scopedRead((tx) => tx.select().from(payrollRuns)
      .where(and(eq(payrollRuns.tenantId, ctx.tenantId), inArray(payrollRuns.month, months))));
    const runIds = runs.map((r) => r.id);

    const slips = runIds.length === 0 ? [] : await scopedRead((tx) => tx.select().from(payrollSlips)
      .where(and(eq(payrollSlips.tenantId, ctx.tenantId), inArray(payrollSlips.runId, runIds))));

    const grossByEmployee = new Map<string, number>();
    for (const slip of slips) {
      if (scopedEmployeeId && slip.employeeId !== scopedEmployeeId) continue;
      grossByEmployee.set(slip.employeeId, (grossByEmployee.get(slip.employeeId) ?? 0) + Number(slip.grossMinor) / 100);
    }

    const decRows = await scopedRead((tx) => tx.select().from(taxDeclarations)
      .where(and(eq(taxDeclarations.tenantId, ctx.tenantId), eq(taxDeclarations.fy, fy))));
    const decByEmployee = new Map(
      decRows.filter((d) => !scopedEmployeeId || d.employeeId === scopedEmployeeId).map((d) => [d.employeeId, d]),
    );

    const employeeIds = new Set<string>([...grossByEmployee.keys(), ...decByEmployee.keys()]);

    // Best-effort identity lookup — a listing degrades gracefully rather than
    // 502ing the whole page when HRMS is unreachable (Form 16 fails hard;
    // this summary doesn't need to).
    let identityById = new Map<string, { fullName: string; departmentId: string }>();
    let hrmsAvailable = true;
    try {
      const input = await fetchPayrollInput(ctx.tenantId, `${startYear + 1}-03`);
      identityById = new Map(input.employees.map((e) => [e.id, { fullName: e.fullName, departmentId: e.departmentId }]));
    } catch (err) {
      if (err instanceof HrmsUnavailableError) hrmsAvailable = false;
      else throw err;
    }

    // DOM-020: was hardcoded 50000 here, disagreeing with domain.ts's
    // config-driven sec80dCapMinor and silently ignoring a tenant's 80D
    // override. Resolve once for the FY.
    const sec80dCapRupees = await resolveSec80dCapRupees(ctx.tenantId, startYear);

    const data = [];
    for (const employeeId of employeeIds) {
      const dec = decByEmployee.get(employeeId) ?? null;
      const regime = (dec?.regime ?? "new") as "old" | "new";
      let exemptions = 0;
      if (regime === "old" && dec) {
        const s80c = Math.min(Number(dec.section80c) / 100, 150000);
        const s80d = Math.min(Number(dec.section80d) / 100, sec80dCapRupees);
        const hra = Number(dec.hraClaimed) / 100;
        const other = Number(dec.otherDeductions) / 100;
        exemptions = s80c + s80d + hra + other;
      }
      // DOM-008 (completing #1117): resolved for the requesting tenant.
      try { exemptions += stdDeduction(regime, startYear, ctx.tenantId); }
      catch (err) { if (err instanceof UnconfiguredFyError) throw new HttpError(422, "FY_NOT_CONFIGURED", err.message); throw err; }

      const grossIncome = Math.round(grossByEmployee.get(employeeId) ?? 0);
      const taxableIncome = Math.round(Math.max(0, grossIncome - exemptions) / 10) * 10;
      let tax;
      try { tax = computeTax(taxableIncome, regime, startYear, ctx.tenantId); }
      catch (err) { if (err instanceof UnconfiguredFyError) throw new HttpError(422, "FY_NOT_CONFIGURED", err.message); throw err; }

      const identity = identityById.get(employeeId);
      data.push({
        id: dec?.id ?? employeeId,
        employee: identity?.fullName ?? employeeId,
        department: identity?.departmentId ?? "-",
        grossIncome: String(grossIncome),
        deductions80C: String(regime === "old" && dec ? Math.min(Number(dec.section80c) / 100, 150000) : 0),
        otherDeductions: String(regime === "old" && dec ? Number(dec.otherDeductions) / 100 : 0),
        taxableIncome: String(taxableIncome),
        taxPayable: String(tax.totalTax),
        status: dec?.status ?? "pending",
      });
    }

    data.sort((a, b) => a.employee.localeCompare(b.employee));

    return reply.send({ data, meta: { total: data.length, fy, hrmsAvailable } });
  });

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

    // Aggregate annual gross from slips for this employee.
    // PERF-005: was one query per FY month for runs, then one query per run
    // for slips — up to 12 + (12 * runsPerMonth) round trips. Now: one
    // inArray() query for all 12 months' runs, then one inArray() query for
    // all those runs' slips for this employee — 2 queries total regardless
    // of how many runs/slips exist in the FY.
    let annualGross = 0;
    let annualBasic = 0;
    let annualPfEmployee = 0;

    const runs = await scopedRead((tx) => tx.select().from(payrollRuns)
      .where(and(eq(payrollRuns.tenantId, ctx.tenantId), inArray(payrollRuns.month, months))));
    const runIds = runs.map((r) => r.id);

    const slips = runIds.length
      ? await scopedRead((tx) => tx.select().from(payrollSlips)
          .where(and(
            inArray(payrollSlips.runId, runIds),
            eq(payrollSlips.employeeId, employeeId),
            eq(payrollSlips.tenantId, ctx.tenantId),
          )))
      : [];
    for (const slip of slips) {
      annualGross += Number(slip.grossMinor) / 100;
      annualBasic += Number(slip.basicMinor) / 100;
      annualPfEmployee += Number(slip.pfEmployeeMinor) / 100;
    }

    // Fetch declarations for exemptions under old regime
    let exemptions = 0;
    if (selectedRegime === "old") {
      const decRows = await scopedRead((tx) => tx.select().from(taxDeclarations)
        .where(and(
          eq(taxDeclarations.tenantId, ctx.tenantId),
          eq(taxDeclarations.employeeId, employeeId),
          eq(taxDeclarations.fy, fy),
        ))
        .limit(1));
      const dec = decRows[0] ?? null;
      if (dec) {
        // DOM-020: 80D cap was hardcoded 50000 (stale -- domain.ts's
        // config-driven sec80dCapMinor is the source of truth and a
        // tenant's override wasn't respected here). Resolved once, so this
        // route agrees with the payslip for the same tenant/FY.
        const sec80dCapRupees = await resolveSec80dCapRupees(ctx.tenantId, startYear);
        const s80c = Math.min(Number(dec.section80c) / 100, 150000); // 80C cap Rs 1.5L
        const s80d = Math.min(Number(dec.section80d) / 100, sec80dCapRupees);
        const hra = Number(dec.hraClaimed) / 100;
        const other = Number(dec.otherDeductions) / 100;
        exemptions = s80c + s80d + hra + other;
      }
      // DOM-008 (completing #1117): resolved for the requesting tenant.
      try { exemptions += stdDeduction("old", startYear, ctx.tenantId); }
      catch (err) { if (err instanceof UnconfiguredFyError) throw new HttpError(422, "FY_NOT_CONFIGURED", err.message); throw err; }
    } else {
      try { exemptions = stdDeduction("new", startYear, ctx.tenantId); }
      catch (err) { if (err instanceof UnconfiguredFyError) throw new HttpError(422, "FY_NOT_CONFIGURED", err.message); throw err; }
    }

    // Sec 288A: round taxable income to nearest 10.
    const taxableIncome = Math.round(Math.max(0, annualGross - exemptions) / 10) * 10;
    let r;
    try {
      r = computeTax(taxableIncome, selectedRegime, startYear, ctx.tenantId);
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
   * CQRS: publishes taxDeclarationSubmit command → 202.
   */
  app.post("/v1/payroll/tax-declarations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITER_ROLES);

    // Server-side zod validation (was an unchecked cast). ZodError → 400 via the
    // shared schema error handler.
    const body = createTaxDeclarationBody.parse(req.body);

    const employeeId = enforceEmployeeOwnership(ctx, body.employeeId);
    // Strict FY check (suffix == (startYear+1) % 100) beyond the regex format.
    parseFy(body.fy);

    const regime = body.regime ?? "new";

    return sendAccepted(reply, acceptedResponseSchema, await commands.submitDeclaration(ctx, {
      employeeId,
      fy: body.fy,
      regime,
      section80c: body.section80c,
      section80d: body.section80d,
      otherDeductions: body.otherDeductions,
      rentPaidMinor: body.rentPaidMinor,
      prevEmployerSalaryMinor: body.prevEmployerSalaryMinor,
      otherSourcesIncomeMinor: body.otherSourcesIncomeMinor,
      perquisitesMinor: body.perquisitesMinor,
    }));
  });

  /**
   * GET /v1/payroll/tax-declarations?employeeId=<uuid>&fy=<string>
   * Returns the employee's current declaration for the given FY (or null).
   */
  app.get("/v1/payroll/tax-declarations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const { employeeId: reqEmployeeId, fy } = req.query as { employeeId?: string; fy?: string };
    const employeeId = enforceEmployeeOwnership(ctx, reqEmployeeId);
    if (!fy) throw new HttpError(400, "VALIDATION_FAILED", "fy is required");
    parseFy(fy);

    const rows = await scopedRead((tx) => tx.select().from(taxDeclarations)
      .where(and(
        eq(taxDeclarations.tenantId, ctx.tenantId),
        eq(taxDeclarations.employeeId, employeeId),
        eq(taxDeclarations.fy, fy),
      ))
      .limit(1));

    const dec = rows[0] ?? null;
    if (!dec) return reply.send(null);

    return reply.send({
      id: dec.id,
      employeeId: dec.employeeId,
      fy: dec.fy,
      regime: dec.regime,
      section80c: Number(dec.section80c),
      section80d: Number(dec.section80d),
      otherDeductions: Number(dec.otherDeductions),
      rentPaidMinor: Number(dec.rentPaidMinor),
      prevEmployerSalaryMinor: Number(dec.prevEmployerSalaryMinor),
      otherSourcesIncomeMinor: Number(dec.otherSourcesIncomeMinor),
      perquisitesMinor: Number(dec.perquisitesMinor),
      status: dec.status,
      createdAt: dec.createdAt,
    });
  });

  /**
   * GET /v1/payroll/tax/exemption-ceilings
   * List all configured statutory exemption ceilings.
   * Auth: payroll_admin, super_admin.
   */
  app.get("/v1/payroll/tax/exemption-ceilings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CEILING_ROLES);

    const rows = await scopedRead((tx) => tx.select().from(exemptionCeilings));

    const data = rows.map((row) => ({
      id: row.id,
      fyStartYear: row.fyStartYear,
      section: row.section,
      ceilingMinor: row.ceilingMinor.toString(),
      notes: row.notes,
      createdAt: row.createdAt,
    }));

    return reply.send({ data, meta: { total: data.length } });
  });

  /**
   * PUT /v1/payroll/tax/exemption-ceilings
   * Upsert a statutory exemption ceiling for a given section + FY.
   * Auth: payroll_admin, super_admin.
   */
  app.put("/v1/payroll/tax/exemption-ceilings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CEILING_ROLES);

    const body = upsertCeilingBody.parse(req.body);

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.upsertExemptionCeiling(ctx, {
        fyStartYear: body.fyStartYear,
        section: body.section,
        ceilingMinor: body.ceilingMinor.toString(),
        notes: body.notes,
      }),
    );
  });
}
