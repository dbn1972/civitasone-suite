/**
 * S8 G7 - project costing (MIS layer v1) routes.
 *
 *   Allocation  POST/GET /v1/payroll/project-costing/allocations, .../:id/decision, .../:id/end
 *   Reports     GET /v1/payroll/project-costing/by-project | by-cost-center | unallocated
 *               GET /v1/payroll/project-costing/projects/:projectId/employees   (per person)
 *   Admin       GET/PUT /v1/payroll/project-costing/settings, POST .../runs/:runId/generate
 *
 * ACCESS (owner decision 10 Nov 2026): a project manager never sees individual
 * pay. Nothing here is open to the `project_manager` role: totals are for the
 * payroll and finance roles, per-person lines only for PAY_DETAIL_ROLES. A
 * project manager reads the project's cost TOTALS from project-service, which
 * only ever receives aggregates (payroll.project_cost.posted carries no
 * employee id). Writes follow CQRS: validate, publish, 202.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { verifyEmployeeExists, HrmsUnavailableError } from "../../shared/hrms-client.js";
import * as commands from "./commands.js";
import { toCsv } from "./csv.js";
import {
  FULL_BPS, MIN_COHORT_FLOOR, buildLeafCells, isIsoDate, isValidSplitPct, pctToBps, rollupByCostCenter, rollupByProject, suppressedCells, type EmployeeLeafRow, type TotalsRow,
} from "./domain.js";
import { isProjectCostingEnabled, loadMinCohort, peakWithCandidate } from "./service.js";

/** Request allocations. */
export const ALLOCATION_WRITE_ROLES = ["payroll_admin", "payroll_officer", "hr_admin", "super_admin"];
/** Approve / reject / end allocations (maker-checker: the approver is never the requester). */
export const ALLOCATION_APPROVE_ROLES = ["payroll_admin", "finance_admin", "super_admin"];
/** Per-person costing: they may see individual pay. */
export const PAY_DETAIL_ROLES = ["payroll_admin", "payroll_officer", "finance_admin", "super_admin"];
/** Project / cost-centre TOTALS. */
export const TOTALS_ROLES = [...PAY_DETAIL_ROLES, "finance_officer"];
const ALLOCATION_READ_ROLES = [...new Set([...ALLOCATION_WRITE_ROLES, ...ALLOCATION_APPROVE_ROLES])];
const SETTINGS_ROLES = ["payroll_admin", "super_admin"];

const isoDate = z.string().refine(isIsoDate, "must be a YYYY-MM-DD date");
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "must be YYYY-MM");
const uuid = z.string().uuid();

export const allocationBody = z.object({
  employeeId: uuid,
  targetType: z.enum(["project", "cost_center"]),
  projectId: uuid.optional(),
  /** For a project line: the project's cost centre (design 8.2: a project line without one is invalid). */
  costCenterId: uuid,
  splitPct: z.number().refine(isValidSplitPct, "splitPct must be above 0 and at most 100, with at most 2 decimals"),
  effectiveFrom: isoDate,
  effectiveTo: isoDate.nullable().optional(),
  note: z.string().trim().max(500).optional(),
}).strict().superRefine((b, ctx) => {
  if (b.targetType === "project" && !b.projectId) ctx.addIssue({ code: "custom", path: ["projectId"], message: "projectId is required for a project allocation" });
  if (b.targetType === "cost_center" && b.projectId) ctx.addIssue({ code: "custom", path: ["projectId"], message: "projectId must be omitted for a cost-centre allocation" });
  if (b.effectiveTo && b.effectiveTo < b.effectiveFrom) ctx.addIssue({ code: "custom", path: ["effectiveTo"], message: "effectiveTo must not be before effectiveFrom" });
});

const rangeQuery = z.object({
  from: period, to: period,
  projectId: uuid.optional(),
  basis: z.enum(["cost_month", "booked"]).default("cost_month"),
  format: z.enum(["json", "csv"]).default("json"),
}).refine((q) => q.from <= q.to, "from must not be after to");

type Row = Record<string, string | null>;
const rowsOf = (r: unknown): Row[] => Array.from(r as Iterable<Row>);

async function requireEnabled(tenantId: string): Promise<void> {
  if (!(await scopedRead((tx) => isProjectCostingEnabled(tx, tenantId)))) {
    throw new HttpError(409, "PROJECT_COSTING_DISABLED", "project costing is not enabled for this tenant");
  }
}

/** The period a line is reported in: the cost month, or (basis=booked) the month of the run that booked it. */
const periodExpr = (basis: "cost_month" | "booked") =>
  basis === "cost_month" ? sql`cost_month` : sql`(CASE WHEN kind = 'run' THEN cost_month ELSE booked_month END)`;

export async function projectCostingRoutes(app: FastifyInstance): Promise<void> {
  const base = "/v1/payroll/project-costing";

  app.get(`${base}/settings`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...new Set([...ALLOCATION_READ_ROLES, ...TOTALS_ROLES])]);
    const { enabled, minCohort } = await scopedRead(async (tx) => ({ enabled: await isProjectCostingEnabled(tx, ctx.tenantId), minCohort: await loadMinCohort(tx, ctx.tenantId) }));
    return reply.send({ data: { enabled, minCohort } });
  });

  app.put(`${base}/settings`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SETTINGS_ROLES);
    const body = z.object({
      enabled: z.boolean().optional(),
      /** Fewest distinct costed people behind a cell shown to a reader without pay-detail access. Never below 2. */
      minCohort: z.number().int().min(MIN_COHORT_FLOOR).max(100).optional(),
    }).strict().refine((b) => b.enabled !== undefined || b.minCohort !== undefined, "provide enabled and/or minCohort").parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateCostingSettings(ctx, body));
  });

  // ─── Allocations ──────────────────────────────────────────────────────────
  app.post(`${base}/allocations`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOCATION_WRITE_ROLES);
    const body = allocationBody.parse(req.body);
    await requireEnabled(ctx.tenantId);
    try {
      if (!(await verifyEmployeeExists(ctx.tenantId, body.employeeId))) throw new HttpError(404, "EMPLOYEE_NOT_FOUND", "employee not found");
    } catch (err) {
      if (err instanceof HrmsUnavailableError) throw new HttpError(503, "HRMS_UNAVAILABLE", "could not verify the employee; try again");
      throw err;
    }
    const to = body.effectiveTo ?? null;
    const peak = await scopedRead((tx) => peakWithCandidate(tx, ctx.tenantId, body.employeeId,
      { bps: pctToBps(body.splitPct), from: body.effectiveFrom, to }, ["active", "pending"]));
    if (peak > FULL_BPS) {
      throw new HttpError(422, "ALLOCATION_EXCEEDS_100",
        `this allocation would take the employee above 100% (the total would reach ${peak / 100}% on at least one day of the period)`);
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.requestAllocation(ctx, {
      employeeId: body.employeeId, targetType: body.targetType, projectId: body.projectId ?? null, costCenterId: body.costCenterId,
      splitPct: body.splitPct, effectiveFrom: body.effectiveFrom, effectiveTo: to, note: body.note ?? null,
    }));
  });

  app.get(`${base}/allocations`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOCATION_READ_ROLES);
    const q = z.object({
      employeeId: uuid.optional(), projectId: uuid.optional(),
      status: z.enum(["pending", "active", "rejected"]).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(200),
    }).parse(req.query);
    const rows = rowsOf(await scopedRead((tx) => tx.execute(sql`
      SELECT id, employee_id, target_type, project_id, cost_center_id, split_pct::text AS split_pct,
             effective_from::text AS effective_from, effective_to::text AS effective_to, status, note,
             requested_by, decided_by, decided_at::text AS decided_at, decision_note
        FROM payroll.employee_cost_allocations
       WHERE tenant_id = ${ctx.tenantId}::uuid
         AND (${q.employeeId ?? null}::uuid IS NULL OR employee_id = ${q.employeeId ?? null}::uuid)
         AND (${q.projectId ?? null}::uuid IS NULL OR project_id = ${q.projectId ?? null}::uuid)
         AND (${q.status ?? null}::text IS NULL OR status = ${q.status ?? null}::text)
       ORDER BY effective_from DESC, id LIMIT ${q.limit}`)));
    return reply.send({ data: rows.map((r) => ({
      id: r.id, employeeId: r.employee_id, targetType: r.target_type, projectId: r.project_id, costCenterId: r.cost_center_id,
      splitPct: r.split_pct, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, status: r.status, note: r.note,
      requestedBy: r.requested_by, decidedBy: r.decided_by, decidedAt: r.decided_at, decisionNote: r.decision_note,
    })), meta: { total: rows.length } });
  });

  const idParam = z.object({ id: uuid });

  app.post(`${base}/allocations/:id/decision`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOCATION_APPROVE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(500).optional() }).strict().parse(req.body);
    const row = rowsOf(await scopedRead((tx) => tx.execute(sql`
      SELECT status, requested_by FROM payroll.employee_cost_allocations WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid`)))[0];
    if (!row) throw new HttpError(404, "NOT_FOUND", "allocation not found");
    if (row.status !== "pending") throw new HttpError(409, "NOT_PENDING", `allocation is already ${row.status}`);
    if (row.requested_by === ctx.actorId) throw new HttpError(403, "SELF_APPROVAL", "the requester cannot decide their own allocation");
    return sendAccepted(reply, acceptedResponseSchema, await commands.decideAllocation(ctx, { id, decision: body.decision, note: body.note ?? null }));
  });

  app.post(`${base}/allocations/:id/end`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOCATION_APPROVE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ effectiveTo: isoDate }).strict().parse(req.body);
    const row = rowsOf(await scopedRead((tx) => tx.execute(sql`
      SELECT status, effective_from::text AS effective_from, effective_to::text AS effective_to
        FROM payroll.employee_cost_allocations WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid`)))[0];
    if (!row) throw new HttpError(404, "NOT_FOUND", "allocation not found");
    if (row.status !== "active") throw new HttpError(409, "NOT_ACTIVE", "only an active allocation can be ended");
    if (body.effectiveTo < row.effective_from! || (row.effective_to !== null && body.effectiveTo >= row.effective_to!)) {
      throw new HttpError(422, "END_DATE_INVALID", "the new end date must be on or after the start and before the current end");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.endAllocation(ctx, { id, effectiveTo: body.effectiveTo }));
  });

  // ─── Reports (totals) ─────────────────────────────────────────────────────
  // Readers without pay-detail access (finance_officer) get SMALL-COHORT SUPPRESSION: a cell that
  // fewer than `minCohort` distinct people stand behind is returned as { suppressed: true } with no
  // amounts and no headcount, and neighbours are hidden too where a hidden cell could be recovered
  // by subtraction (see suppressedCells). Pay-detail roles see everything.
  const loadCells = async (tenantId: string, from: string, to: string, basis: "cost_month" | "booked") => {
    const p = periodExpr(basis);
    const rows = rowsOf(await scopedRead((tx) => tx.execute(sql`
      SELECT ${p} AS period, line_key, target_type, project_id, cost_center_id, employee_id,
             SUM(gross_minor)::text AS g, SUM(employer_pf_minor + employer_esi_minor + employer_nps_minor + other_employer_minor)::text AS e,
             SUM(total_cost_minor)::text AS t
        FROM payroll.slip_cost_lines
       WHERE tenant_id = ${tenantId}::uuid AND ${p} BETWEEN ${from} AND ${to}
       GROUP BY ${p}, line_key, target_type, project_id, cost_center_id, employee_id`)));
    return buildLeafCells(rows.map((r): EmployeeLeafRow => ({
      period: r.period as string, lineKey: r.line_key as string, targetType: r.target_type as EmployeeLeafRow["targetType"], projectId: r.project_id ?? null,
      costCenterId: r.cost_center_id ?? null, employeeId: r.employee_id as string, gross: BigInt(r.g as string), employer: BigInt(r.e as string), total: BigInt(r.t as string),
    })));
  };
  /**
   * `booked` omits reclass deltas that no run has booked yet, so it can show a DIFFERENT cohort and amounts than
   * `cost_month` for the same cell; a reader who may run both could subtract them and isolate the reclassed person.
   * Readers without pay-detail access therefore get `cost_month` only (the base the suppression is judged on).
   */
  const assertBasisAllowed = (ctx: ReturnType<typeof resolveContext>, basis: "cost_month" | "booked"): void => {
    if (basis === "booked" && !ctx.roles.some((r) => PAY_DETAIL_ROLES.includes(r))) {
      throw new HttpError(403, "BASIS_RESTRICTED", "the booked basis is only available to payroll and finance administrators");
    }
  };
  const hiddenFor = async (ctx: ReturnType<typeof resolveContext>, cells: ReturnType<typeof buildLeafCells>): Promise<{ hidden: Set<string>; minCohort: number | null }> => {
    if (ctx.roles.some((r) => PAY_DETAIL_ROLES.includes(r))) return { hidden: new Set(), minCohort: null };
    const k = await scopedRead((tx) => loadMinCohort(tx, ctx.tenantId));
    return { hidden: suppressedCells(cells, k), minCohort: k };
  };
  const shape = (r: TotalsRow) => r.suppressed
    ? { period: r.period, suppressed: true, reason: "MIN_COHORT" }
    : { period: r.period, suppressed: false, grossMinor: r.grossMinor, employerCostMinor: r.employerCostMinor, totalCostMinor: r.totalCostMinor, headcount: r.headcount };
  const csvRow = (id: unknown, r: TotalsRow) => [r.period, id, r.suppressed ? "yes" : "no", r.grossMinor ?? "", r.employerCostMinor ?? "", r.totalCostMinor ?? "", r.headcount ?? ""];

  app.get(`${base}/by-project`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TOTALS_ROLES);
    const q = rangeQuery.parse(req.query);
    assertBasisAllowed(ctx, q.basis);
    const cells = await loadCells(ctx.tenantId, q.from, q.to, q.basis);
    const { hidden, minCohort } = await hiddenFor(ctx, cells);
    // The filter runs AFTER suppression so one project's visibility never depends on which project was asked for.
    const rows = rollupByProject(cells, hidden).filter((r) => !q.projectId || r.projectId === q.projectId);
    if (q.format === "csv") {
      return reply.header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="project-cost-${q.from}-${q.to}.csv"`)
        .send(toCsv(["period", "projectId", "suppressed", "grossMinor", "employerCostMinor", "totalCostMinor", "headcount"], rows.map((r) => csvRow(r.projectId, r))));
    }
    return reply.send({ from: q.from, to: q.to, basis: q.basis, minCohort, data: rows.map((r) => ({ ...shape(r), projectId: r.projectId })) });
  });

  app.get(`${base}/by-cost-center`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TOTALS_ROLES);
    const q = rangeQuery.parse(req.query);
    assertBasisAllowed(ctx, q.basis);
    const cells = await loadCells(ctx.tenantId, q.from, q.to, q.basis);
    const { hidden, minCohort } = await hiddenFor(ctx, cells);
    const { data, unallocated } = rollupByCostCenter(cells, hidden);
    if (q.format === "csv") {
      return reply.header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="cost-centre-cost-${q.from}-${q.to}.csv"`)
        .send(toCsv(["period", "costCenterId", "suppressed", "grossMinor", "employerCostMinor", "totalCostMinor", "headcount"],
          [...data.map((r) => csvRow(r.costCenterId, r)), ...unallocated.map((r) => csvRow("unallocated", r))]));
    }
    return reply.send({ from: q.from, to: q.to, basis: q.basis, minCohort,
      data: data.map((r) => ({ ...shape(r), costCenterId: r.costCenterId })), unallocated: unallocated.map(shape) });
  });

  const totalsSelect = sql`
    SUM(gross_minor)::text AS gross_minor,
    SUM(employer_pf_minor + employer_esi_minor + employer_nps_minor + other_employer_minor)::text AS employer_cost_minor,
    SUM(total_cost_minor)::text AS total_cost_minor,
    COUNT(DISTINCT employee_id) FILTER (WHERE kind = 'run')::int AS headcount`;

  // ─── Per-person (pay detail roles only) ───────────────────────────────────
  app.get(`${base}/projects/:projectId/employees`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAY_DETAIL_ROLES);
    const { projectId } = z.object({ projectId: uuid }).parse(req.params);
    const q = rangeQuery.parse(req.query);
    const p = periodExpr(q.basis);
    const data = rowsOf(await scopedRead((tx) => tx.execute(sql`
      SELECT employee_id, ${totalsSelect}
        FROM payroll.slip_cost_lines
       WHERE tenant_id = ${ctx.tenantId}::uuid AND target_type = 'project' AND project_id = ${projectId}::uuid AND ${p} BETWEEN ${q.from} AND ${q.to}
       GROUP BY employee_id ORDER BY employee_id`)));
    return reply.send({ projectId, from: q.from, to: q.to, basis: q.basis, data: data.map((r) => ({
      employeeId: r.employee_id, grossMinor: r.gross_minor, employerCostMinor: r.employer_cost_minor, totalCostMinor: r.total_cost_minor })) });
  });

  app.get(`${base}/unallocated`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAY_DETAIL_ROLES);
    const { period: per } = z.object({ period }).parse(req.query);
    const data = rowsOf(await scopedRead((tx) => tx.execute(sql`
      SELECT employee_id, split_bps, total_cost_minor::text AS total_cost_minor
        FROM payroll.slip_cost_lines
       WHERE tenant_id = ${ctx.tenantId}::uuid AND kind = 'run' AND cost_month = ${per} AND target_type = 'unallocated'
       ORDER BY total_cost_minor::bigint DESC, employee_id`)));
    return reply.send({ period: per, data: data.map((r) => ({ employeeId: r.employee_id, unallocatedPct: (Number(r.split_bps) / 100).toFixed(2), totalCostMinor: r.total_cost_minor })) });
  });

  app.post(`${base}/runs/:runId/generate`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SETTINGS_ROLES);
    const { runId } = z.object({ runId: uuid }).parse(req.params);
    await requireEnabled(ctx.tenantId);
    const run = rowsOf(await scopedRead((tx) => tx.execute(sql`
      SELECT status FROM payroll.payroll_runs WHERE id = ${runId}::uuid AND tenant_id = ${ctx.tenantId}::uuid`)))[0];
    if (!run) throw new HttpError(404, "NOT_FOUND", "payroll run not found");
    if (!["approved", "disbursed"].includes(run.status ?? "")) throw new HttpError(409, "RUN_NOT_FINAL", "only an approved or disbursed run can be costed");
    return sendAccepted(reply, acceptedResponseSchema, await commands.generateRunCost(ctx, { runId }));
  });
}
