/**
 * F&F Settlement routes — compute, read, and internal tax breakdown.
 *
 * POST  /v1/payroll/fnf/compute           → publish fnfCompute command → 202
 * GET   /v1/payroll/fnf/settlements/:id   → read single settlement
 * GET   /v1/payroll/fnf/settlements       → list settlements (filter by employeeId)
 * GET   /v1/payroll/internal/fnf-tax-breakdown → internal: compute on-the-fly for hrms-service
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { fnfSettlements } from "./schema.js";
import { exemptionCeilings } from "./schema.js";
import { eq, and } from "drizzle-orm";
import { computeFnfSettlement, type FnfInput } from "./domain.js";

const FNF_ROLES = ["payroll_admin", "hr_admin", "super_admin", "finance_officer"];

const computeFnfBody = z.object({
  employeeId: z.string().uuid(),
  separationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  separationType: z.enum(["retirement", "superannuation", "resignation", "retrenchment", "vrs", "death"]),
  employeeCategory: z.enum(["govt", "non_govt_covered", "non_govt_uncovered"]),
  noticeBuyoutMinor: z.string().transform((v) => BigInt(v)).default("0"),
  leaveEncashmentGrossMinor: z.string().transform((v) => BigInt(v)).default("0"),
  gratuityGrossMinor: z.string().transform((v) => BigInt(v)).default("0"),
  retrenchmentCompMinor: z.string().transform((v) => BigInt(v)).default("0"),
  vrsCompMinor: z.string().transform((v) => BigInt(v)).default("0"),
  arrearsMinor: z.string().transform((v) => BigInt(v)).default("0"),
  lastDrawnWagesMinor: z.string().transform((v) => BigInt(v)),
  completedYears: z.number().int().min(0),
  avgSalaryLast10MonthsMinor: z.string().transform((v) => BigInt(v)),
  leaveBalanceDays: z.number().int().min(0),
  priorLeaveEncashExemptionMinor: z.string().transform((v) => BigInt(v)).default("0"),
  remainingMonthsToRetirement: z.number().int().min(0).default(0),
  taxRegime: z.enum(["old", "new"]),
  salaryYtdMinor: z.string().transform((v) => BigInt(v)),
  tdsYtdMinor: z.string().transform((v) => BigInt(v)),
  deductions80cMinor: z.string().transform((v) => BigInt(v)).default("0"),
  deductions80dMinor: z.string().transform((v) => BigInt(v)).default("0"),
  otherDeductionsMinor: z.string().transform((v) => BigInt(v)).default("0"),
  fyStartYear: z.number().int(),
});

const idParamSchema = z.object({ id: z.string().uuid() });

const listQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Internal endpoint query schema — used by hrms-service to get tax breakdown without persisting. */
const internalBreakdownQuery = z.object({
  employeeId: z.string().uuid(),
  separationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  separationType: z.enum(["retirement", "superannuation", "resignation", "retrenchment", "vrs", "death"]),
  employeeCategory: z.enum(["govt", "non_govt_covered", "non_govt_uncovered"]),
  noticeBuyoutMinor: z.string().transform((v) => BigInt(v)).default("0"),
  leaveEncashmentGrossMinor: z.string().transform((v) => BigInt(v)).default("0"),
  gratuityGrossMinor: z.string().transform((v) => BigInt(v)).default("0"),
  retrenchmentCompMinor: z.string().transform((v) => BigInt(v)).default("0"),
  vrsCompMinor: z.string().transform((v) => BigInt(v)).default("0"),
  arrearsMinor: z.string().transform((v) => BigInt(v)).default("0"),
  lastDrawnWagesMinor: z.string().transform((v) => BigInt(v)),
  completedYears: z.coerce.number().int().min(0),
  avgSalaryLast10MonthsMinor: z.string().transform((v) => BigInt(v)),
  leaveBalanceDays: z.coerce.number().int().min(0),
  priorLeaveEncashExemptionMinor: z.string().transform((v) => BigInt(v)).default("0"),
  remainingMonthsToRetirement: z.coerce.number().int().min(0).default(0),
  taxRegime: z.enum(["old", "new"]),
  salaryYtdMinor: z.string().transform((v) => BigInt(v)),
  tdsYtdMinor: z.string().transform((v) => BigInt(v)),
  deductions80cMinor: z.string().transform((v) => BigInt(v)).default("0"),
  deductions80dMinor: z.string().transform((v) => BigInt(v)).default("0"),
  otherDeductionsMinor: z.string().transform((v) => BigInt(v)).default("0"),
  fyStartYear: z.coerce.number().int(),
});

export async function fnfRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/payroll/fnf/compute
   * Publishes payroll.fnf.compute command for async processing. Returns 202.
   */
  app.post("/v1/payroll/fnf/compute", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FNF_ROLES);

    const body = computeFnfBody.parse(req.body);

    await db.transaction(async (tx) => {
      await enqueue(tx, {
        topic: COMMANDS.fnfCompute,
        eventType: COMMANDS.fnfCompute,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          employeeId: body.employeeId,
          tenantId: ctx.tenantId,
          separationDate: body.separationDate,
          separationType: body.separationType,
          employeeCategory: body.employeeCategory,
          noticeBuyoutMinor: body.noticeBuyoutMinor.toString(),
          leaveEncashmentGrossMinor: body.leaveEncashmentGrossMinor.toString(),
          gratuityGrossMinor: body.gratuityGrossMinor.toString(),
          retrenchmentCompMinor: body.retrenchmentCompMinor.toString(),
          vrsCompMinor: body.vrsCompMinor.toString(),
          arrearsMinor: body.arrearsMinor.toString(),
          lastDrawnWagesMinor: body.lastDrawnWagesMinor.toString(),
          completedYears: body.completedYears,
          avgSalaryLast10MonthsMinor: body.avgSalaryLast10MonthsMinor.toString(),
          leaveBalanceDays: body.leaveBalanceDays,
          priorLeaveEncashExemptionMinor: body.priorLeaveEncashExemptionMinor.toString(),
          remainingMonthsToRetirement: body.remainingMonthsToRetirement,
          taxRegime: body.taxRegime,
          salaryYtdMinor: body.salaryYtdMinor.toString(),
          tdsYtdMinor: body.tdsYtdMinor.toString(),
          deductions80cMinor: body.deductions80cMinor.toString(),
          deductions80dMinor: body.deductions80dMinor.toString(),
          otherDeductionsMinor: body.otherDeductionsMinor.toString(),
          fyStartYear: body.fyStartYear,
        },
      });
    });

    return reply.status(202).send({ data: { message: "fnf compute queued", employeeId: body.employeeId } });
  });

  /**
   * GET /v1/payroll/fnf/settlements/:id
   * Read a single F&F settlement by ID (tenant-scoped).
   */
  app.get("/v1/payroll/fnf/settlements/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FNF_ROLES);

    const { id } = idParamSchema.parse(req.params);

    const rows = await scopedRead((tx) => tx
      .select()
      .from(fnfSettlements)
      .where(and(eq(fnfSettlements.id, id), eq(fnfSettlements.tenantId, ctx.tenantId)))
      .limit(1));

    if (rows.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "settlement not found");
    }

    return reply.send({ data: serializeSettlement(rows[0]!) });
  });

  /**
   * GET /v1/payroll/fnf/settlements
   * List settlements for a tenant, optionally filtered by employeeId.
   */
  app.get("/v1/payroll/fnf/settlements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FNF_ROLES);

    const q = listQuerySchema.parse(req.query);

    const conditions = [eq(fnfSettlements.tenantId, ctx.tenantId)];
    if (q.employeeId) {
      conditions.push(eq(fnfSettlements.employeeId, q.employeeId));
    }

    const rows = await scopedRead((tx) => tx
      .select()
      .from(fnfSettlements)
      .where(and(...conditions))
      .limit(q.limit)
      .offset(q.offset));

    return reply.send({ data: rows.map(serializeSettlement), meta: { limit: q.limit, offset: q.offset } });
  });

  /**
   * GET /v1/payroll/internal/fnf-tax-breakdown
   * Internal endpoint for hrms-service. Computes F&F on-the-fly (no persist).
   * Loads exemption ceilings from DB, runs domain logic, returns full breakdown.
   */
  app.get("/v1/payroll/internal/fnf-tax-breakdown", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FNF_ROLES);

    const params = internalBreakdownQuery.parse(req.query);

    // Load ceilings for the FY
    const ceilings = await scopedRead((tx) => tx
      .select()
      .from(exemptionCeilings)
      .where(eq(exemptionCeilings.fyStartYear, params.fyStartYear)));

    const ceilingMap = new Map(ceilings.map((c) => [c.section, c.ceilingMinor]));

    const input: FnfInput = {
      employeeId: params.employeeId,
      tenantId: ctx.tenantId,
      separationType: params.separationType as FnfInput["separationType"],
      separationDate: params.separationDate,
      employeeCategory: params.employeeCategory as FnfInput["employeeCategory"],
      noticeBuyoutMinor: params.noticeBuyoutMinor,
      leaveEncashmentGrossMinor: params.leaveEncashmentGrossMinor,
      gratuityGrossMinor: params.gratuityGrossMinor,
      retrenchmentCompMinor: params.retrenchmentCompMinor,
      vrsCompMinor: params.vrsCompMinor,
      arrearsMinor: params.arrearsMinor,
      lastDrawnWagesMinor: params.lastDrawnWagesMinor,
      completedYears: params.completedYears,
      avgSalaryLast10MonthsMinor: params.avgSalaryLast10MonthsMinor,
      leaveBalanceDays: params.leaveBalanceDays,
      priorLeaveEncashExemptionMinor: params.priorLeaveEncashExemptionMinor,
      remainingMonthsToRetirement: params.remainingMonthsToRetirement,
      taxRegime: params.taxRegime,
      salaryYtdMinor: params.salaryYtdMinor,
      tdsYtdMinor: params.tdsYtdMinor,
      deductions80cMinor: params.deductions80cMinor,
      deductions80dMinor: params.deductions80dMinor,
      otherDeductionsMinor: params.otherDeductionsMinor,
      fyStartYear: params.fyStartYear,
      gratuityCeilingMinor: ceilingMap.get("10_10") ?? 2000000000n,
      leaveEncashCeilingMinor: ceilingMap.get("10_10AA") ?? 2500000000n,
      retrenchmentCeilingMinor: ceilingMap.get("10_10B") ?? 500000000n,
      vrsCeilingMinor: ceilingMap.get("10_10C") ?? 500000000n,
    };

    const result = computeFnfSettlement(input);

    return reply.send({
      data: {
        totalGrossMinor: result.totalGrossMinor.toString(),
        totalExemptMinor: result.totalExemptMinor.toString(),
        totalTaxableOnSeparationMinor: result.totalTaxableOnSeparationMinor.toString(),
        annualTaxableMinor: result.annualTaxableMinor.toString(),
        annualTaxMinor: result.annualTaxMinor.toString(),
        tdsAlreadyDeductedMinor: result.tdsAlreadyDeductedMinor.toString(),
        tdsOnSeparationMinor: result.tdsOnSeparationMinor.toString(),
        netPayableMinor: result.netPayableMinor.toString(),
        gratuityExemption: {
          exemptMinor: result.gratuityExemption.exemptMinor.toString(),
          taxableMinor: result.gratuityExemption.taxableMinor.toString(),
        },
        leaveEncashExemption: {
          exemptMinor: result.leaveEncashExemption.exemptMinor.toString(),
          taxableMinor: result.leaveEncashExemption.taxableMinor.toString(),
        },
        retrenchmentExemption: result.retrenchmentExemption
          ? { exemptMinor: result.retrenchmentExemption.exemptMinor.toString(), taxableMinor: result.retrenchmentExemption.taxableMinor.toString() }
          : null,
        vrsExemption: result.vrsExemption
          ? { exemptMinor: result.vrsExemption.exemptMinor.toString(), taxableMinor: result.vrsExemption.taxableMinor.toString() }
          : null,
      },
    });
  });
}

/** Serialize bigint fields to string for JSON transport. */
function serializeSettlement(row: typeof fnfSettlements.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    tenantId: row.tenantId,
    employeeId: row.employeeId,
    runId: row.runId,
    separationType: row.separationType,
    separationDate: row.separationDate,
    employeeCategory: row.employeeCategory,
    noticeBuyoutMinor: row.noticeBuyoutMinor.toString(),
    leaveEncashmentGrossMinor: row.leaveEncashmentGrossMinor.toString(),
    gratuityGrossMinor: row.gratuityGrossMinor.toString(),
    retrenchmentCompMinor: row.retrenchmentCompMinor.toString(),
    vrsCompMinor: row.vrsCompMinor.toString(),
    arrearsMinor: row.arrearsMinor.toString(),
    gratuityExemptMinor: row.gratuityExemptMinor.toString(),
    leaveEncashExemptMinor: row.leaveEncashExemptMinor.toString(),
    retrenchmentExemptMinor: row.retrenchmentExemptMinor.toString(),
    vrsExemptMinor: row.vrsExemptMinor.toString(),
    totalTaxableMinor: row.totalTaxableMinor.toString(),
    tdsOnSeparationMinor: row.tdsOnSeparationMinor.toString(),
    netPayableMinor: row.netPayableMinor.toString(),
    computationDetail: row.computationDetail,
    status: row.status,
    currency: row.currency,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    version: row.version,
  };
}
