/**
 * F&F Settlement routes — compute, read, and internal tax breakdown.
 *
 * POST  /v1/payroll/fnf/compute           → publish fnfCompute command → 202
 * GET   /v1/payroll/fnf/settlements/:id   → read single settlement
 * GET   /v1/payroll/fnf/settlements       → list settlements (filter by employeeId)
 * GET   /v1/payroll/internal/fnf-tax-breakdown → internal: compute on-the-fly for hrms-service
 * POST  /v1/payroll/fnf/settlements/:id/{submit,finance-approve,disburse,reject}
 *       → GAP-PAYROLL-FNF-01 maker-checker workflow (./workflow.ts) → 202
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { fnfSettlements } from "./schema.js";
import { exemptionCeilings } from "./schema.js";
import { eq, and } from "drizzle-orm";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { computeFnfSettlement, type FnfInput } from "./domain.js";
import { fetchEmployeeSummaries } from "../../shared/hrms-client.js";
import { deterministicUuid } from "../../shared/deterministic-id.js";
import {
  FNF_ACTIONS, FNF_SUBMIT_ROLES, FNF_FINANCE_APPROVE_ROLES, FNF_DISBURSE_ROLES, FNF_REJECT_ROLES,
  decideTransition, type FnfAction,
} from "./workflow.js";

const FNF_ROLES = ["payroll_admin", "hr_admin", "super_admin", "finance_officer"];
const AUDIT_TOPIC = "audit.event.record";
// GAP-PAYROLL-FNF-01: payroll_officer may submit a settlement (workflow.ts),
// so it must be able to see the list/detail it submits from. Compute stays
// on FNF_ROLES.
const FNF_READ_ROLES = [...FNF_ROLES, "payroll_officer"];

/** Today's date in IST as YYYY-MM-DD (payment dates are Indian calendar dates). */
function todayIst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, "must be a real calendar date");

const transitionBase = z.object({ version: z.number().int().min(1) });
const TRANSITION_BODIES = {
  submit: transitionBase.extend({ note: z.string().trim().max(512).optional() }),
  "finance-approve": transitionBase.extend({ note: z.string().trim().max(512).optional() }),
  reject: transitionBase.extend({ reason: z.string().trim().min(10).max(512) }),
  // Disburse records a payment made outside this system (no bank
  // integration): the UTR / cheque / transaction reference and the date
  // the money actually left, both entered by the user.
  disburse: transitionBase.extend({
    paymentReference: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9/-]{3,63}$/, "4-64 letters, digits, '/' or '-'"),
    paymentDate: isoDate.refine((v) => v <= todayIst(), "payment date cannot be in the future"),
    note: z.string().trim().max(512).optional(),
  }),
} as const;

/** Roles checked BEFORE the row is read (the per-status rule for reject is applied by decideTransition). */
const ACTION_GATE_ROLES: Record<FnfAction, string[]> = {
  submit: FNF_SUBMIT_ROLES,
  "finance-approve": FNF_FINANCE_APPROVE_ROLES,
  disburse: FNF_DISBURSE_ROLES,
  reject: FNF_REJECT_ROLES,
};

// GAP-PAYROLL-FNF-03: every money field used to be
// `z.string().transform((v) => BigInt(v))` -- BigInt("1234.5") /
// BigInt("abc") threw a raw SyntaxError out of the transform (an unhandled
// 500, not a 400) and a negative "-5" was accepted as a negative payout
// input. Now a whole, non-negative paise integer string only.
const minor = () => z.string().regex(/^\d{1,15}$/, "must be a whole number of paise").transform((v) => BigInt(v));

/** Fields the web form pre-fills from HR records and lets the user override (with a reason). */
export const FNF_OVERRIDABLE_FIELDS = ["completedYears", "leaveBalanceDays"] as const;

// GAP-PAYROLL-FNF-03: when the clerk overrides a record-derived input, the
// reason travels with the compute command and is persisted in the
// settlement's computation_detail + the audit event, so a hand-typed value
// that decides a final payout is never silent.
const overridesSchema = z.object({
  fields: z.array(z.enum(FNF_OVERRIDABLE_FIELDS)).min(1),
  reason: z.string().trim().min(10).max(500),
});

const computeFnfBody = z.object({
  employeeId: z.string().uuid(),
  separationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  separationType: z.enum(["retirement", "superannuation", "resignation", "retrenchment", "vrs", "death"]),
  employeeCategory: z.enum(["govt", "non_govt_covered", "non_govt_uncovered"]),
  noticeBuyoutMinor: minor().default("0"),
  leaveEncashmentGrossMinor: minor().default("0"),
  gratuityGrossMinor: minor().default("0"),
  retrenchmentCompMinor: minor().default("0"),
  vrsCompMinor: minor().default("0"),
  arrearsMinor: minor().default("0"),
  lastDrawnWagesMinor: minor(),
  completedYears: z.number().int().min(0),
  avgSalaryLast10MonthsMinor: minor(),
  // GAP-HR-LEAVE-APPLY-05: half-day leave means the balance can be x.5.
  leaveBalanceDays: z.number().min(0).multipleOf(0.5),
  priorLeaveEncashExemptionMinor: minor().default("0"),
  remainingMonthsToRetirement: z.number().int().min(0).default(0),
  taxRegime: z.enum(["old", "new"]),
  salaryYtdMinor: minor(),
  tdsYtdMinor: minor(),
  deductions80cMinor: minor().default("0"),
  deductions80dMinor: minor().default("0"),
  otherDeductionsMinor: minor().default("0"),
  fyStartYear: z.number().int(),
  overrides: overridesSchema.optional(),
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
  leaveBalanceDays: z.coerce.number().min(0).multipleOf(0.5),
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

    const messageId = randomUUID();
    await queue.publish(COMMANDS.fnfCompute, {
      messageId,
      type: COMMANDS.fnfCompute,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
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
        ...(body.overrides ? { overrides: body.overrides } : {}),
      },
    });

    return reply.status(202).send({ data: { id: messageId, message: "fnf compute queued", employeeId: body.employeeId } });
  });

  /**
   * GET /v1/payroll/fnf/settlements/:id
   * Read a single F&F settlement by ID (tenant-scoped).
   */
  app.get("/v1/payroll/fnf/settlements/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FNF_READ_ROLES);

    const { id } = idParamSchema.parse(req.params);

    const rows = await scopedRead((tx) => tx
      .select()
      .from(fnfSettlements)
      .where(and(eq(fnfSettlements.id, id), eq(fnfSettlements.tenantId, ctx.tenantId)))
      .limit(1));

    if (rows.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "settlement not found");
    }

    const empMap = await fetchEmployeeSummaries(ctx.tenantId);
    return reply.send({ data: serializeSettlement(rows[0]!, empMap) });
  });

  /**
   * GET /v1/payroll/fnf/settlements
   * List settlements for a tenant, optionally filtered by employeeId.
   */
  app.get("/v1/payroll/fnf/settlements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FNF_READ_ROLES);

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

    // GAP-PAYROLL-FNF-05: enrich with the employee's name and employee number
    // the same best-effort way statutory/queries.ts#listGpfReport does --
    // fetchEmployeeSummaries fails open to an empty Map on an unreachable
    // HRMS, so this never gates the list (the card then shows a neutral
    // "Unknown employee" label, never the raw UUID).
    const empMap = await fetchEmployeeSummaries(ctx.tenantId);
    return reply.send({ data: rows.map((r) => serializeSettlement(r, empMap)), meta: { limit: q.limit, offset: q.offset } });
  });

  /**
   * POST /v1/payroll/fnf/settlements/:id/{submit,finance-approve,disburse,reject}
   *
   * GAP-PAYROLL-FNF-01. Every rule (status, version, role, segregation of
   * duties) is checked here so the caller gets a 403/409 instead of a 202
   * the consumer silently drops, then re-asserted by the consumer under a
   * row lock. The body's `version` is the one the caller loaded; the
   * messageId is derived from (id, action, version, actor) so a double-click
   * publishes the same command twice and the inbox dedups it. Denied
   * segregation-of-duties attempts are audited (outcome "denied").
   */
  for (const action of FNF_ACTIONS) {
    app.post(`/v1/payroll/fnf/settlements/:id/${action}`, async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, ACTION_GATE_ROLES[action]);
      const { id } = idParamSchema.parse(req.params);
      const body = TRANSITION_BODIES[action].parse(req.body ?? {}) as {
        version: number; note?: string; reason?: string; paymentReference?: string; paymentDate?: string;
      };

      const rows = await scopedRead((tx) => tx
        .select({
          status: fnfSettlements.status,
          version: fnfSettlements.version,
          createdBy: fnfSettlements.createdBy,
          computedBy: fnfSettlements.computedBy,
          submittedBy: fnfSettlements.submittedBy,
          financeApprovedBy: fnfSettlements.financeApprovedBy,
        })
        .from(fnfSettlements)
        .where(and(eq(fnfSettlements.id, id), eq(fnfSettlements.tenantId, ctx.tenantId)))
        .limit(1));
      const row = rows[0];
      if (!row) throw new HttpError(404, "NOT_FOUND", "settlement not found");

      const decision = decideTransition(action, row, { id: ctx.actorId, roles: ctx.roles }, body.version);
      if (!decision.ok) {
        if (decision.code === "FNF_SELF_APPROVAL_FORBIDDEN" || decision.code === "FNF_SELF_DISBURSAL_FORBIDDEN") {
          // A blocked segregation-of-duties attempt is itself audit-worthy.
          // Queue-first, same shape as loans/commands.ts disburseLoan.
          await queue.publish(AUDIT_TOPIC, {
            messageId: randomUUID(),
            type: AUDIT_TOPIC,
            tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
            payload: {
              service: "payroll", action: `fnf_${action.replace("-", "_")}`, resourceType: "fnf_settlement",
              resourceId: id, outcome: "denied", denialCode: decision.code, status: row.status,
            },
          });
        }
        throw new HttpError(decision.status, decision.code, decision.message);
      }

      await queue.publish(COMMANDS.fnfTransition, {
        // Same person double-clicking dedupes; a different person's attempt
        // is a distinct command (the consumer's lock + predicate picks one).
        messageId: deterministicUuid(`payroll-fnf-transition:${id}:${action}:v${body.version}:${ctx.actorId}`),
        type: COMMANDS.fnfTransition,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        schemaVersion: "1.0",
        payload: {
          id,
          tenantId: ctx.tenantId,
          action,
          expectedVersion: body.version,
          ...(body.note ? { note: body.note } : {}),
          ...(body.reason ? { reason: body.reason } : {}),
          ...(body.paymentReference ? { paymentReference: body.paymentReference } : {}),
          ...(body.paymentDate ? { paymentDate: body.paymentDate } : {}),
        },
      });
      return sendAccepted(reply, acceptedResponseSchema, {
        id, status: "accepted", correlationId: ctx.correlationId,
        data: { id, requestedStatus: decision.to },
      });
    });
  }

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
      // No-config-row fallback, in paise (₹1L = ₹1,00,000; paise = rupees ×
      // 100). Previously 10x too high (2000000000n etc.) -- see migration
      // 0048_fix_fnf_exemption_ceilings_10x.sql for the full writeup; these
      // MUST always match that migration's corrected seed values exactly.
      gratuityCeilingMinor: ceilingMap.get("10_10") ?? 200000000n,     // ₹20L
      leaveEncashCeilingMinor: ceilingMap.get("10_10AA") ?? 250000000n, // ₹25L
      retrenchmentCeilingMinor: ceilingMap.get("10_10B") ?? 50000000n,  // ₹5L
      vrsCeilingMinor: ceilingMap.get("10_10C") ?? 50000000n,           // ₹5L
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
function serializeSettlement(
  row: typeof fnfSettlements.$inferSelect,
  empMap: Map<string, { fullName: string; employeeNo?: string | null }> = new Map(),
): Record<string, unknown> {
  const emp = empMap.get(row.employeeId);
  return {
    id: row.id,
    tenantId: row.tenantId,
    employeeId: row.employeeId,
    employeeName: emp?.fullName ?? null,
    employeeCode: emp?.employeeNo ?? null,
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
    // GAP-PAYROLL-FNF-01 workflow trail.
    computedBy: row.computedBy ?? row.createdBy,
    submittedBy: row.submittedBy,
    submittedAt: row.submittedAt,
    financeApprovedBy: row.financeApprovedBy,
    financeApprovedAt: row.financeApprovedAt,
    disbursedBy: row.disbursedBy,
    disbursedAt: row.disbursedAt,
    paymentReference: row.paymentReference,
    paymentDate: row.paymentDate,
    rejectedBy: row.rejectedBy,
    rejectedAt: row.rejectedAt,
    rejectionReason: row.rejectionReason,
  };
}
