/**
 * World-class gap features — Routes for simulation, corrections, off-cycle,
 * pay groups, flex benefits, costing, and tax optimization.
 *
 * CQRS lift T1-03: the eight mutating routes previously performed synchronous
 * DB writes in the request path. They now publish a command
 * (payroll/commands.ts) and return 202; the write happens in the idempotent
 * consumer (payroll/consumer.ts), tenant-scoped via runWithTenant in worker.ts.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { sql } from "drizzle-orm";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopeEmployeeId, requireOwnEmployeeId, staffRolesOf } from "../../shared/employee-scope.js";
import { scopedRead } from "../../shared/db.js";
import { resolveRunStatutoryConfig } from "./consumer.js";
import * as commands from "./commands.js";
import { stateRulesBody } from "./state-rules.js";
import { inForceRows } from "./pt-versions-repo.js";
import { todayIst } from "./pt-versions-domain.js";
import { validatePaySchedule, payDatesForMonth, type PayFrequency } from "./fin03-domain.js";
import { assertElectionWithinPlan } from "./adjustment-guards.js";
import { isValidIanaTimeZone } from "./validators.js";
import { resolveVerificationPlan, verifiedDeductionFigures, NO_VERIFIED, istToday } from "../tax/verified-inputs.js";
import { fetchEmployeeSummaries } from "../../shared/hrms-client.js";
import { exceedsCap, isValidSplitPct, otherActiveSplitHundredths } from "../costing-rules/split-cap.js";
import { PAY_GROUP_BILL_TYPES, todayIst } from "./pay-group-domain.js";
import { assertActiveDdo } from "./pay-group-guards.js";

const PAYROLL_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
const READER_ROLES = [...PAYROLL_ROLES, "hr_admin", "finance_officer"];
const ALL_ROLES = [...READER_ROLES, "employee"];
const ALL_STAFF_ROLES = staffRolesOf(ALL_ROLES);

const offCycleProcessBody = z.object({ reason: z.string().trim().min(10).max(512) });

// GAP-PAYROLL-PAY-GROUPS-01: kept outside the handler so the handler body stays
// the parse -> command -> sendAccepted shape the CQRS static tests pin.
const createPayGroupBody = z.object({
  name: z.string().min(1).max(128),
  frequency: z.enum(["monthly", "bi_weekly", "weekly"]),
  payDayOfMonth: z.number().int().min(1).max(31).default(28),
  timezone: z.string().max(64).default("Asia/Kolkata")
    .refine(isValidIanaTimeZone, "must be an IANA timezone name, e.g. Asia/Kolkata"),
  // GAP-PAYROLL-PAY-GROUPS-01: weekday / last-day / bi-weekly parity.
  payWeekday: z.number().int().min(1).max(7).nullable().optional(),
  payLastDay: z.boolean().optional(),
  payWeekParity: z.number().int().min(0).max(1).nullable().optional(),
  // GAP-PAYROLL-PAY-GROUPS-03: the DDO whose bill this is (must be active) + bill type.
  ddoCode: z.string().trim().min(1).max(32).nullable().optional(),
  billType: z.enum(PAY_GROUP_BILL_TYPES).optional(),
}).superRefine((b, c) => {
  const problem = validatePaySchedule(b);
  if (problem) c.addIssue({ code: z.ZodIssueCode.custom, path: ["frequency"], message: problem });
});

export async function gapRoutes(app: FastifyInstance): Promise<void> {
  // ─── Gap 1: Payroll Simulation ──────────────────────────────────────────────
  app.post("/v1/payroll/runs/:id/simulate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    // Verify run exists
    const runs = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, month, status FROM payroll.payroll_runs
      WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid LIMIT 1
    `))) as unknown as Array<{ id: string; month: string; status: string }>;
    if (!runs[0]) throw new HttpError(404, "NOT_FOUND", "payroll run not found");
    const run = runs[0];

    // Pull existing slips for this run as simulated data
    const slips = (await scopedRead((tx) => tx.execute(sql`
      SELECT employee_id, employee_no, gross_minor, total_deductions_minor, net_pay_minor, tds_minor
      FROM payroll.payroll_slips
      WHERE run_id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid
    `))) as unknown as Array<{
      employee_id: string; employee_no: string; gross_minor: string;
      total_deductions_minor: string; net_pay_minor: string; tds_minor: string;
    }>;

    // Pull previous month slips for variance comparison
    const [yr, mo] = run.month.split("-").map(Number) as [number, number];
    const prevMonth = mo === 1 ? `${yr - 1}-12` : `${yr}-${String(mo - 1).padStart(2, "0")}`;
    const prevSlips = (await scopedRead((tx) => tx.execute(sql`
      SELECT s.employee_id, s.net_pay_minor
      FROM payroll.payroll_slips s
      JOIN payroll.payroll_runs r ON r.id = s.run_id
      WHERE r.month = ${prevMonth} AND s.tenant_id = ${ctx.tenantId}::uuid
    `))) as unknown as Array<{ employee_id: string; net_pay_minor: string }>;
    const prevMap = new Map(prevSlips.map((s) => [s.employee_id, BigInt(s.net_pay_minor)]));

    const threshold = 20; // % variance flag threshold
    const results = slips.map((s) => {
      const netMinor = BigInt(s.net_pay_minor);
      const prev = prevMap.get(s.employee_id) ?? 0n;
      const variance = prev > 0n ? Number((netMinor - prev) * 100n / prev) : 0;
      return {
        employeeId: s.employee_id, employeeNo: s.employee_no,
        grossMinor: Number(s.gross_minor), deductionsMinor: Number(s.total_deductions_minor),
        netMinor: Number(s.net_pay_minor), tdsMinor: Number(s.tds_minor),
        previousNetMinor: Number(prev), variancePct: Math.round(variance * 100) / 100,
        flagged: Math.abs(variance) > threshold,
      };
    });

    const totalGross = results.reduce((s, r) => s + r.grossMinor, 0);
    const totalNet = results.reduce((s, r) => s + r.netMinor, 0);
    const flaggedCount = results.filter((r) => r.flagged).length;

    return reply.send({
      runId: id, month: run.month, mode: "simulate",
      employeeCount: results.length, flaggedCount,
      totalGrossMinor: totalGross, totalNetMinor: totalNet,
      anomalyThresholdPct: threshold,
      employees: results,
    });
  });

  // ─── Gap 3: Salary Corrections ─────────────────────────────────────────────
  app.post("/v1/payroll/corrections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const body = z.object({
      employeeId: z.string().uuid(),
      component: z.string().min(1).max(32),
      effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      newValueMinor: z.number().int(),
      oldValueMinor: z.number().int(),
      reason: z.string().max(512).optional(),
    }).parse(req.body);

    // Affected-periods count depends on the current wall-clock month, so we
    // compute it here (pure function) and pass it in the command payload —
    // keeps the consumer deterministic replay-safe.
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const effMonth = body.effectiveFrom.slice(0, 7);
    let periods = 0;
    let [y, m] = effMonth.split("-").map(Number) as [number, number];
    const [cy, cm] = currentMonth.split("-").map(Number) as [number, number];
    while (y < cy || (y === cy && m <= cm)) { periods++; m++; if (m > 12) { m = 1; y++; } }
    const diffPerPeriod = BigInt(body.newValueMinor - body.oldValueMinor);
    const totalArrears = diffPerPeriod * BigInt(periods);

    return sendAccepted(reply, acceptedResponseSchema, await commands.createCorrection(ctx, {
      ...body,
      affectedPeriods: periods,
      arrearsMinor: totalArrears.toString(),
    }));
  });

  app.get("/v1/payroll/corrections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = z.object({ employeeId: z.string().uuid().optional() }).parse(req.query);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, employee_id, component, effective_from::text AS effective_from,
        old_value_minor, new_value_minor, arrears_minor, affected_periods, reason, status, created_at,
        created_by, decided_by, decided_at, decision_note
      FROM payroll.salary_corrections
      WHERE tenant_id = ${ctx.tenantId}::uuid
        ${q.employeeId ? sql`AND employee_id = ${q.employeeId}::uuid` : sql``}
      ORDER BY created_at DESC LIMIT 100
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows });
  });

  // GAP-PAYROLL-CORRECTIONS-01: maker-checker decision on a pending
  // correction. A correction used to sit at 'pending' forever (no endpoint
  // could move it). The checker must differ from the maker (same rule as
  // payroll-run approval, consumer.ts SELF_APPROVAL_FORBIDDEN); the check is
  // done here synchronously so the caller gets a 403/409 instead of a 202
  // that the consumer silently drops, and re-asserted in the consumer's
  // conditional UPDATE for race safety.
  const decisionBody = z.object({ note: z.string().trim().max(512).optional() });
  const rejectBody = z.object({ note: z.string().trim().min(1).max(512) });
  for (const decision of ["approve", "reject"] as const) {
    app.post(`/v1/payroll/corrections/:id/${decision}`, async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, PAYROLL_ROLES);
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      // A rejection must say why; an approval note is optional.
      const body = (decision === "reject" ? rejectBody : decisionBody).parse(req.body ?? {});
      const rows = (await scopedRead((tx) => tx.execute(sql`
        SELECT status, created_by FROM payroll.salary_corrections
        WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid
        LIMIT 1
      `))) as unknown as Array<{ status: string; created_by: string }>;
      const row = rows[0];
      if (!row) throw new HttpError(404, "NOT_FOUND", "correction not found");
      if (row.status !== "pending") {
        throw new HttpError(409, "CORRECTION_NOT_PENDING", `correction is already ${row.status}`);
      }
      if (row.created_by === ctx.actorId) {
        throw new HttpError(403, "SELF_APPROVAL_FORBIDDEN", "a correction must be decided by someone other than its creator");
      }
      return sendAccepted(reply, acceptedResponseSchema, await commands.decideCorrection(ctx, {
        id,
        decision: decision === "approve" ? "approved" : "rejected",
        note: body.note,
      }));
    });
  }

  // ─── Gap 2: Pay Groups ────────────────────────────────────────────────────
  app.post("/v1/payroll/pay-groups", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const body = createPayGroupBody.parse(req.body);
    await assertActiveDdo(ctx.tenantId, body.ddoCode);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPayGroup(ctx, body));
  });

  app.get("/v1/payroll/pay-groups", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    // GAP-PAYROLL-PAY-GROUPS-03: deactivated ('archived') groups are listed
    // only on request, so the default response is unchanged.
    const q = z.object({ includeInactive: z.enum(["true", "false"]).optional() }).parse(req.query);
    const includeInactive = q.includeInactive === "true";
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT g.id, g.name, g.frequency, g.pay_day_of_month, g.pay_weekday, g.pay_last_day, g.pay_week_parity,
             g.timezone, g.status, g.created_at, g.ddo_code, g.bill_type,
             (SELECT COUNT(*)::int FROM payroll.employee_pay_group_assignments a
               WHERE a.tenant_id = g.tenant_id AND a.pay_group_id = g.id
                 AND a.effective_from <= ${todayIst()}::date AND (a.effective_to IS NULL OR a.effective_to > ${todayIst()}::date)) AS "employeeCount"
      FROM payroll.pay_groups g
      WHERE g.tenant_id = ${ctx.tenantId}::uuid AND (${includeInactive} OR g.status = 'active')
      ORDER BY g.name LIMIT 100
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows });
  });

  app.get("/v1/payroll/calendar", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.query);
    const startYear = parseInt(q.fy.slice(0, 4), 10);
    const groups = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, name, frequency, pay_day_of_month, pay_weekday, pay_last_day, pay_week_parity FROM payroll.pay_groups
      WHERE tenant_id = ${ctx.tenantId}::uuid AND status = 'active'
    `))) as unknown as Array<{
      id: string; name: string; frequency: PayFrequency; pay_day_of_month: number;
      pay_weekday: number | null; pay_last_day: boolean; pay_week_parity: number | null;
    }>;

    // Generate pay calendar: Apr startYear to Mar startYear+1. Monthly (and
    // legacy weekday-less) groups yield one date per month exactly as before;
    // weekly / bi-weekly groups with a weekday yield every pay date.
    const calendar: Array<{ group: string; month: string; payDate: string }> = [];
    const months: Array<[number, number]> = [];
    for (let m = 4; m <= 12; m++) months.push([startYear, m]);
    for (let m = 1; m <= 3; m++) months.push([startYear + 1, m]);
    for (const g of groups) {
      for (const [y, m] of months) {
        for (const payDate of payDatesForMonth({
          frequency: g.frequency, payDayOfMonth: g.pay_day_of_month,
          payWeekday: g.pay_weekday, payLastDay: g.pay_last_day, payWeekParity: g.pay_week_parity,
        }, y, m)) {
          calendar.push({ group: g.name, month: `${y}-${String(m).padStart(2, "0")}`, payDate });
        }
      }
    }
    return reply.send({ fy: q.fy, groups: groups.length, calendar });
  });

  // ─── Gap 5: Flex Benefits ─────────────────────────────────────────────────
  app.post("/v1/payroll/flex-benefits/plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const body = z.object({
      name: z.string().min(1).max(128),
      fy: z.string().regex(/^\d{4}-\d{2}$/),
      totalBudgetMinor: z.number().int().positive(),
      components: z.array(z.object({
        name: z.string(), maxMinor: z.number().int().positive(), taxExempt: z.boolean().default(false),
      })).min(1).max(20),
    }).parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createFlexPlan(ctx, body));
  });

  app.post("/v1/payroll/flex-benefits/elections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const body = z.object({
      planId: z.string().uuid(),
      fy: z.string().regex(/^\d{4}-\d{2}$/),
      elections: z.array(z.object({ component: z.string(), electedMinor: z.number().int().min(0) })).min(1),
    }).parse(req.body);
    // GAP-PAYROLL-FLEX-BENEFITS-01/03: the election must name only this
    // plan's components, each within its max, total within the plan budget,
    // same FY -- previously any planId/component/amount was accepted.
    await assertElectionWithinPlan(ctx, body);
    // An election is always the caller's OWN. Stored against their hrms
    // employee id (resolved here, before enqueueing, so the consumer needs no
    // HRMS) -- not ctx.actorId, a different id space -- so any future
    // application or lookup by employee id matches it (payroll runs do not
    // apply flex elections today). Fails closed: 502 HRMS down, 403 unlinked.
    const employeeId = await requireOwnEmployeeId(ctx);
    const totalElectedMinor = body.elections.reduce((s, e) => s + e.electedMinor, 0);
    return sendAccepted(reply, acceptedResponseSchema, await commands.upsertFlexElection(ctx, {
      ...body,
      employeeId,
      totalElectedMinor,
    }));
  });

  // GAP-PAYROLL-FLEX-BENEFITS-01: list active plans so the election form can
  // offer a plan picker + its components/caps instead of a hand-typed plan
  // UUID. Plan definitions are tenant config (name/FY/budget/component
  // caps) -- no employee data -- so every role that may elect may read them.
  app.get("/v1/payroll/flex-benefits/plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(req.query);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, name, fy, total_budget_minor, components, status
      FROM payroll.flex_benefit_plans
      WHERE tenant_id = ${ctx.tenantId}::uuid AND status = 'active'
        ${q.fy ? sql`AND fy = ${q.fy}` : sql``}
      ORDER BY fy DESC, name LIMIT 100
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows });
  });

  app.get("/v1/payroll/flex-benefits/my-elections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    // Keyed by the caller's hrms employee id, matching the write above (rows
    // written before that fix carried the login user id; see
    // flex-election-backfill.ts for the one-off repair).
    const employeeId = await requireOwnEmployeeId(ctx);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT e.id, e.plan_id, e.fy, e.elections, e.total_elected_minor, e.status, p.name AS plan_name
      FROM payroll.flex_benefit_elections e
      JOIN payroll.flex_benefit_plans p ON p.id = e.plan_id
      WHERE e.tenant_id = ${ctx.tenantId}::uuid AND e.employee_id = ${employeeId}::uuid
      ORDER BY e.fy DESC LIMIT 10
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows });
  });

  // GAP-PAYROLL-FLEX-BENEFITS-05: the approver's queue. Payroll roles only.
  // Bounded limit/offset + total + stable ORDER BY (created_at, id); employee
  // NAMES come from the hrms directory (fails open to null -> the UI shows a
  // neutral label, never the UUID).
  app.get("/v1/payroll/flex-benefits/elections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const q = z.object({
      status: z.enum(["submitted", "approved", "rejected"]).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      offset: z.coerce.number().int().min(0).max(100000).default(0),
    }).parse(req.query);
    const statusFilter = q.status ? sql`AND e.status = ${q.status}` : sql``;
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT e.id, e.employee_id, e.plan_id, p.name AS plan_name, e.fy, e.elections,
             e.total_elected_minor::text AS total_elected_minor,
             md5(e.elections::text || e.total_elected_minor::text) AS etag, e.status,
             e.created_by, e.created_at, e.reviewed_at, e.review_reason,
             (e.created_by = ${ctx.actorId}::uuid) AS is_own_submission
        FROM payroll.flex_benefit_elections e
        JOIN payroll.flex_benefit_plans p ON p.id = e.plan_id AND p.tenant_id = e.tenant_id
       WHERE e.tenant_id = ${ctx.tenantId}::uuid ${statusFilter}
       ORDER BY e.created_at DESC, e.id
       LIMIT ${q.limit} OFFSET ${q.offset}
    `))) as unknown as Array<Record<string, unknown> & { employee_id: string }>;
    const totals = (await scopedRead((tx) => tx.execute(sql`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status = 'submitted')::int AS pending
        FROM payroll.flex_benefit_elections e
       WHERE e.tenant_id = ${ctx.tenantId}::uuid ${statusFilter}
    `))) as unknown as Array<{ total: number; pending: number }>;
    const names = await fetchEmployeeSummaries(ctx.tenantId);
    return reply.send({
      data: rows.map((r) => ({ ...r, employee_name: names.get(r.employee_id)?.fullName ?? null })),
      total: totals[0]?.total ?? 0,
      pending: totals[0]?.pending ?? 0,
      limit: q.limit,
      offset: q.offset,
    });
  });

  // GAP-PAYROLL-FLEX-BENEFITS-05: maker-checker decision. The route answers
  // 404/409/403 for what it can see; the consumer re-asserts all of it in one
  // conditional UPDATE (race-safe) and audits the decision. Reject needs a
  // reason (>= 10 chars); an approval reason is optional.
  for (const decision of ["approve", "reject"] as const) {
    app.post(`/v1/payroll/flex-benefits/elections/:id/${decision}`, async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, PAYROLL_ROLES);
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = z.object({
        // md5 of what the reviewer saw (GET .../elections `etag`); a changed election is 409 STALE_ELECTION.
        etag: z.string().regex(/^[0-9a-f]{32}$/),
        reason: decision === "reject" ? z.string().trim().min(10).max(512) : z.string().trim().max(512).optional(),
      }).parse(req.body ?? {});
      const rows = (await scopedRead((tx) => tx.execute(sql`
        SELECT e.status, e.created_by, md5(e.elections::text || e.total_elected_minor::text) AS etag,
               COALESCE((SELECT s.flex_election_maker_checker FROM payroll.payroll_settings s
                          WHERE s.tenant_id = e.tenant_id), TRUE) AS maker_checker
          FROM payroll.flex_benefit_elections e
         WHERE e.id = ${id}::uuid AND e.tenant_id = ${ctx.tenantId}::uuid LIMIT 1
      `))) as unknown as Array<{ status: string; created_by: string; etag: string; maker_checker: boolean }>;
      const row = rows[0];
      if (!row) throw new HttpError(404, "NOT_FOUND", "election not found");
      if (row.status !== "submitted") {
        throw new HttpError(409, "ELECTION_NOT_PENDING", `election is already ${row.status}`);
      }
      if (row.etag !== body.etag) {
        throw new HttpError(409, "STALE_ELECTION", "the election changed after you loaded it; refresh and review it again");
      }
      if (row.maker_checker && row.created_by === ctx.actorId) {
        throw new HttpError(403, "SELF_APPROVAL_FORBIDDEN", "an election must be decided by someone other than its submitter");
      }
      return sendAccepted(reply, acceptedResponseSchema, await commands.decideFlexElection(ctx, {
        id,
        decision: decision === "approve" ? "approved" : "rejected",
        etag: body.etag,
        reason: body.reason || undefined,
      }));
    });
  }

  // ─── Gap 6: Costing Rules ────────────────────────────────────────────────
  app.post("/v1/payroll/costing/rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const body = z.object({
      employeeGroup: z.string().min(1).max(64),
      costCenterId: z.string().uuid(),
      splitPct: z.number().min(0).max(100).default(100),
    }).parse(req.body);
    // GAP-PAYROLL-COSTING-02: server-side 2dp + group-cap authority (the
    // consumer repeats the cap check under a per-group lock).
    if (!isValidSplitPct(body.splitPct)) {
      throw new HttpError(422, "COSTING_SPLIT_INVALID", "splitPct must be above 0 and at most 100, with at most 2 decimals");
    }
    const others = await scopedRead((tx) => otherActiveSplitHundredths(tx, ctx.tenantId, body.employeeGroup, { costCenterId: body.costCenterId }));
    if (exceedsCap(others, body.splitPct)) {
      throw new HttpError(422, "COSTING_SPLIT_EXCEEDS_100",
        `this rule would take employee group "${body.employeeGroup}" above 100% (other active rules already total ${others / 100}%)`);
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.upsertCostingRule(ctx, body));
  });

  // FE gap (quality-payroll-95): the costing page previously had no way to
  // list rules — only create (POST) existed — so it showed a static
  // "not yet available" EmptyState. This closes that gap.
  app.get("/v1/payroll/costing/rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, employee_group, cost_center_id, split_pct, status, created_at
      FROM payroll.costing_rules
      WHERE tenant_id = ${ctx.tenantId}::uuid
      ORDER BY employee_group, cost_center_id
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  app.get("/v1/payroll/costing/report", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.query);
    // Bug fix (found with GAP-PAYROLL-COSTING-01): the period condition sat on
    // a LEFT JOIN to payroll_runs, which never filters payroll_slips -- so
    // every rule allocated split% of ALL slips the tenant ever had, in every
    // period. The slip set is now restricted to runs of the requested month.
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT cr.employee_group, cr.cost_center_id, cr.split_pct,
        COALESCE(SUM(ps.gross_minor * cr.split_pct / 100), 0)::bigint AS allocated_minor
      FROM payroll.costing_rules cr
      LEFT JOIN (
        SELECT s.tenant_id, s.gross_minor
        FROM payroll.payroll_slips s
        JOIN payroll.payroll_runs r ON r.id = s.run_id AND r.tenant_id = s.tenant_id
        WHERE s.tenant_id = ${ctx.tenantId}::uuid AND r.month = ${q.period}
          -- Review fix (PR #1762): only finalised runs -- the same set the YTD
          -- TDS query uses (consumer.ts resolveTdsYtdMinorsTx). A failed run
          -- keeps its slips and a rerun is allowed for the same month, so
          -- without this the month's gross was allocated twice.
          AND r.status IN ('approved', 'disbursed')
      ) ps ON ps.tenant_id = cr.tenant_id
      WHERE cr.tenant_id = ${ctx.tenantId}::uuid AND cr.status = 'active'
      GROUP BY cr.employee_group, cr.cost_center_id, cr.split_pct
      ORDER BY cr.employee_group
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ period: q.period, data: rows });
  });

  // ─── Gap 7: Tax Optimization Advisor ──────────────────────────────────────
  app.get("/v1/payroll/tax/optimization", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = z.object({ employeeId: z.string().uuid().optional() }).parse(req.query);
    // SEC-P2-02: a self-service `employee` caller may only see their OWN
    // tax-optimization advice — without this, any employee could pass a
    // co-worker's UUID as employeeId and read their 80C/80D declaration
    // usage and remaining headroom (cross-employee financial disclosure).
    const employeeId = await scopeEmployeeId(ctx, q.employeeId, ALL_STAFF_ROLES);

    // Fetch current declarations
    const now = new Date();
    const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fy = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const decRows = (await scopedRead((tx) => tx.execute(sql`
      SELECT section_80c, section_80d, other_deductions, rent_paid_minor, regime
      FROM payroll.payroll_tax_declarations
      WHERE tenant_id = ${ctx.tenantId}::uuid AND employee_id = ${employeeId}::uuid AND fy = ${fy}
      ORDER BY created_at DESC LIMIT 1
    `))) as unknown as Array<{ section_80c: string; section_80d: string; other_deductions: string; rent_paid_minor: string; regime: string }>;
    let dec = decRows[0];
    // GAP-PAYROLL-TAX-DECLARATION-02: follow the same declared-vs-verified switch as TDS.
    if (dec) {
      const plan = await scopedRead((tx) => resolveVerificationPlan(tx, ctx.tenantId, fy, istToday(), [employeeId]));
      if (plan.apply) {
        const f = verifiedDeductionFigures(
          { section80c: BigInt(dec.section_80c), section80d: BigInt(dec.section_80d), otherDeductions: BigInt(dec.other_deductions), rentPaidMinor: BigInt(dec.rent_paid_minor), hraClaimed: 0n },
          plan.verified.get(employeeId) ?? NO_VERIFIED,
        );
        dec = { ...dec, section_80c: String(f.section80c), section_80d: String(f.section80d), other_deductions: String(f.otherDeductions), rent_paid_minor: String(f.rentPaidMinor) };
      }
    }

    // DOM-025/DOM-026/DOM-034: cap80c, cap80d and the 80CCD(1B) headroom
    // were independently hardcoded (Rs 1.5L / Rs 50,000 / Rs 50,000, paise),
    // disagreeing with domain.ts's config-driven sec80cCapMinor/
    // sec80dCapMinor/sec80ccd1bCapMinor (DOM-008's platform defaults Rs 1.5L
    // / Rs 75,000 / Rs 50,000) and silently ignoring a tenant's override --
    // same bug class DOM-020 fixed in tax/routes.ts. Resolve the same
    // effective-dated config through scopedRead(), as of the current month
    // (this route advises on the in-progress FY's remaining headroom, not a
    // closed FY snapshot). DOM-025 fixed cap80d first, DOM-026 added
    // sec80cCapMinor, DOM-034 (migration 0041) adds the sibling
    // sec80ccd1bCapMinor field -- all three come from this SAME
    // already-fetched config object, zero extra DB round-trips.
    const { sec80cCapMinor, sec80dCapMinor, sec80ccd1bCapMinor } = await scopedRead((tx) => resolveRunStatutoryConfig(tx, ctx.tenantId, currentMonth));

    const cap80c = sec80cCapMinor;
    const cap80d = sec80dCapMinor;
    const used80c = dec ? BigInt(dec.section_80c) : 0n;
    const used80d = dec ? BigInt(dec.section_80d) : 0n;
    const remaining80c = cap80c - used80c > 0n ? cap80c - used80c : 0n;
    const remaining80d = cap80d - used80d > 0n ? cap80d - used80d : 0n;

    const suggestions: Array<{ section: string; headroom: number; suggestion: string }> = [];
    if (remaining80c > 0n) {
      suggestions.push({ section: "80C", headroom: Number(remaining80c), suggestion: "Invest in PPF/ELSS/NSC/LIC to utilize remaining 80C headroom" });
    }
    if (remaining80d > 0n) {
      suggestions.push({ section: "80D", headroom: Number(remaining80d), suggestion: "Health insurance premium (self/family/parents) can reduce taxable income" });
    }
    // DOM-034: headroom is the resolved cap itself, not cap-minus-used --
    // payroll_tax_declarations has no section_80ccd_1b (or equivalent)
    // column to read a "used" amount from, unlike 80C/80D above. This
    // mirrors the pre-fix route's own original semantics (always the full
    // cap), just no longer a bare literal. The suggestion text previously
    // hardcoded "up to ₹50,000" a second time in the same object -- a
    // second, independent occurrence of the identical bug class DOM-026
    // fixed for tax/routes.ts's income-tax listing (a hardcoded figure that
    // could silently disagree with a tenant-overridden headroom) -- removed
    // rather than interpolated, matching the 80C/80D suggestion strings
    // above, neither of which embeds a cap figure either.
    suggestions.push({ section: "80CCD(1B)", headroom: Number(sec80ccd1bCapMinor), suggestion: "Additional NPS (Tier-I) contribution to utilize 80CCD(1B) headroom, deductible beyond 80C" });

    return reply.send({
      employeeId, fy, regime: dec?.regime ?? "new",
      used80cMinor: Number(used80c), used80dMinor: Number(used80d),
      remaining80cMinor: Number(remaining80c), remaining80dMinor: Number(remaining80d),
      suggestions,
    });
  });

  app.get("/v1/payroll/tax/regime-comparison", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = z.object({ employeeId: z.string().uuid().optional() }).parse(req.query);
    // SEC-P2-02: same ownership guard as /v1/payroll/tax/optimization above.
    // This route currently only returns stub/placeholder figures (see
    // comment below), so it isn't independently exploitable today — fixed
    // for consistency so it doesn't become a silent gap the moment real
    // computation is wired in here.
    const employeeId = await scopeEmployeeId(ctx, q.employeeId, ALL_STAFF_ROLES);
    // Simplified comparison — in production this calls the full tax engine
    return reply.send({
      employeeId,
      oldRegime: { estimatedTaxMinor: 0, note: "Requires full annual income computation" },
      newRegime: { estimatedTaxMinor: 0, note: "Requires full annual income computation" },
      recommendation: "Use GET /v1/payroll/tax/computation with regime=old and regime=new for exact comparison",
    });
  });

  // ─── Gap 8: Off-Cycle Payments ────────────────────────────────────────────
  app.post("/v1/payroll/off-cycle", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const body = z.object({
      runType: z.enum(["bonus", "incentive", "adhoc"]),
      period: z.string().regex(/^\d{4}-\d{2}$/),
      description: z.string().max(256).optional(),
      items: z.array(z.object({
        employeeId: z.string().uuid(),
        amountMinor: z.number().int().positive(),
      })).min(1).max(1000),
    }).parse(req.body);
    const totalAmountMinor = body.items.reduce((s, i) => s + BigInt(i.amountMinor), 0n).toString();
    return sendAccepted(reply, acceptedResponseSchema, await commands.createOffCycle(ctx, {
      ...body,
      totalAmountMinor,
    }));
  });

  app.get("/v1/payroll/off-cycle", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT r.id, r.run_type, r.period, r.description, r.total_amount_minor, r.total_tax_minor,
        r.total_net_minor, r.status, r.created_at, r.created_by,
        -- GAP-PAYROLL-OFF-CYCLE-02: the run card's "Employees in scope"
        -- read a field this list never returned.
        (SELECT count(*)::int FROM payroll.off_cycle_items i
          WHERE i.off_cycle_run_id = r.id AND i.tenant_id = r.tenant_id) AS employee_count
      FROM payroll.off_cycle_runs r WHERE r.tenant_id = ${ctx.tenantId}::uuid
      ORDER BY r.created_at DESC LIMIT 50
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows });
  });

  app.post("/v1/payroll/off-cycle/:id/process", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    // 404 pre-check: keep the existence guard in the route (read-only). The
    // actual 30% flat-tax computation now runs in the consumer — single
    // source of truth alongside the persisted update.
    const runs = (await scopedRead((tx) => tx.execute(sql`
      SELECT r.status, r.created_by,
        EXISTS (SELECT 1 FROM payroll.off_cycle_items i
                WHERE i.off_cycle_run_id = r.id AND i.tenant_id = r.tenant_id) AS has_items
      FROM payroll.off_cycle_runs r
      WHERE r.id = ${id}::uuid AND r.tenant_id = ${ctx.tenantId}::uuid
      LIMIT 1
    `))) as unknown as Array<{ status: string; created_by: string; has_items: boolean }>;
    const run = runs[0];
    if (!run || !run.has_items) throw new HttpError(404, "NOT_FOUND", "off-cycle run not found or has no items");
    // GAP-PAYROLL-OFF-CYCLE-01: processing fixes tax and net pay and is
    // irreversible, so it is the checker step of a maker-checker pair: the
    // user who created the run may not process it (same rule as payroll-run
    // approval), and only a draft run can be processed. Re-asserted in the
    // consumer for race safety.
    if (run.status !== "draft") {
      throw new HttpError(409, "OFF_CYCLE_NOT_DRAFT", `off-cycle run is already ${run.status}`);
    }
    if (run.created_by === ctx.actorId) {
      throw new HttpError(403, "SELF_APPROVAL_FORBIDDEN", "an off-cycle run must be processed by someone other than its creator");
    }
    // GAP-PAYROLL-OFF-CYCLE-04: processing is irreversible -- a reason is
    // mandatory and is written to the audit record (after the GAP-PAYROLL-
    // OFF-CYCLE-01 existence / draft / creator checks above).
    const { reason } = offCycleProcessBody.parse(req.body);

    return sendAccepted(reply, acceptedResponseSchema, await commands.processOffCycle(ctx, id, reason));
  });

  // ─── Gap 4: Multi-State PT/LWF (CRUD for state rules) ────────────────────
  app.post("/v1/payroll/statutory/state-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    // GAP-PAYROLL-STATUTORY-PT-04: PT slabs are effective-dated, immutable versions now --
    // they are created through POST /v1/payroll/statutory/pt/versions, never overwritten
    // here. Refuse loudly rather than silently dropping them.
    if (req.body && typeof req.body === "object" && "ptSlabs" in (req.body as Record<string, unknown>)) {
      throw new HttpError(422, "PT_SLABS_USE_VERSIONS", "professional tax slabs are versioned; create a new version with POST /v1/payroll/statutory/pt/versions");
    }
    const body = stateRulesBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.upsertStateRules(ctx, body));
  });

  app.get("/v1/payroll/statutory/state-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    // The slab version in force today, per state; the full timeline is GET .../statutory/pt/versions.
    const pt = await scopedRead((tx) => inForceRows(tx as never, ctx.tenantId, todayIst()));
    const lwf = (await scopedRead((tx) => tx.execute(sql`
      SELECT state_code, employee_contrib_minor, employer_contrib_minor, frequency
      FROM payroll.payroll_lwf WHERE tenant_id = ${ctx.tenantId}::uuid
      ORDER BY state_code
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ ptSlabs: pt, lwfConfig: lwf });
  });

  // Error handler
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
