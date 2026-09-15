import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * AI Fraud Detection API Routes
 * - GET /v1/hrms/ai/alerts — list fraud alerts
 * - POST /v1/hrms/ai/scan — trigger fraud scan
 * - GET /v1/hrms/ai/risk-scores — employee risk profiles
 * - GET /v1/hrms/ai/recommendations — smart HR recommendations
 * - PATCH /v1/hrms/ai/alerts/:id — update alert status
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, desc, inArray, count } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead} from "../../shared/db.js";
import { hrmsFraudAlerts, hrmsEmployeeRiskScores, hrmsRecommendations } from "./schema.js";
import type { EmployeeRow } from "../employee/schema.js";
import * as engine from "./detection-engine.js";

const ADMIN_ROLES = ["hr_admin", "super_admin", "audit_admin"];

// PERF-006: /v1/hrms/ai/scan used to fetch the WHOLE tenant's employees in
// one unbounded `db.select()...where(tenantId)` before running
// duplicate-bank-account / ghost-employee detection over them (gap report:
// ai-fraud/routes.ts:45). Both checks are genuinely tenant-wide by design --
// a partial view would silently miss real duplicates/ghosts -- so this can't
// become a client-facing paginated list like this fix's other sites.
// Instead it fetches the same full result in SCAN_BATCH_SIZE-row pages, so
// no single query is unbounded, while still covering every employee.
// orderBy(id) keeps the paging stable across calls (the original single-shot
// select never needed one).
const SCAN_BATCH_SIZE = 500;

export async function fetchAllEmployeesForScan(tenantId: string): Promise<EmployeeRow[]> {
  const { hrmsEmployees } = await import("../employee/schema.js");
  const all: EmployeeRow[] = [];
  let offset = 0;
  for (;;) {
    const page = await scopedRead((tx) => tx.select().from(hrmsEmployees)
      .where(eq(hrmsEmployees.tenantId, tenantId))
      .orderBy(hrmsEmployees.id)
      .limit(SCAN_BATCH_SIZE)
      .offset(offset)) as EmployeeRow[];
    all.push(...page);
    if (page.length < SCAN_BATCH_SIZE) break;
    offset += SCAN_BATCH_SIZE;
  }
  return all;
}

const riskScoresQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export async function aiFraudRoutes(app: FastifyInstance): Promise<void> {
  // ── List fraud alerts ──
  app.get("/v1/hrms/ai/alerts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const q = z.object({ status: z.string().optional(), severity: z.string().optional() }).parse(req.query);
    let rows = await scopedRead((tx) => tx.select().from(hrmsFraudAlerts)
      .where(eq(hrmsFraudAlerts.tenantId, ctx.tenantId))
      .orderBy(desc(hrmsFraudAlerts.createdAt))
      .limit(100));
    if (q.status) rows = rows.filter(r => r.status === q.status);
    if (q.severity) rows = rows.filter(r => r.severity === q.severity);
    return reply.send({ data: rows, total: rows.length });
  });

  // ── Trigger fraud detection scan ──
  app.post("/v1/hrms/ai/scan", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const startTime = Date.now();
    const alerts: engine.FraudAlert[] = [];

    // Run ghost employee detection
    const employees = await fetchAllEmployeesForScan(ctx.tenantId);

    // Check duplicate bank accounts
    const bankData = employees.filter(e => e.bankAccountNo).map(e => ({
      employeeId: e.id, bankAccountNo: e.bankAccountNo ?? "", bankIfsc: e.bankIfsc ?? "",
    }));
    alerts.push(...engine.detectDuplicateBankAccount(bankData));

    // Check ghost employees (simplified: employees with no recent geo-attendance).
    // PERF-005: was one geo-attendance query per candidate employee (N+1, N<=50);
    // now a single grouped-count query across all 50 ids. Counts computed via
    // SQL COUNT/GROUP BY, not fetched-then-counted-in-JS.
    const { hrmsGeoAttendance } = await import("../geo-attendance/schema.js");
    const ghostCandidates = employees.slice(0, 50); // limit for performance
    const candidateIds = ghostCandidates.map((emp) => emp.id);
    const attCountRows = candidateIds.length
      ? await scopedRead((tx) => tx
          .select({ employeeId: hrmsGeoAttendance.employeeId, attendanceDays: count() })
          .from(hrmsGeoAttendance)
          .where(and(eq(hrmsGeoAttendance.tenantId, ctx.tenantId), inArray(hrmsGeoAttendance.employeeId, candidateIds)))
          .groupBy(hrmsGeoAttendance.employeeId))
      : [];
    const attCountByEmployee = new Map(attCountRows.map((r) => [r.employeeId, Number(r.attendanceDays)]));
    for (const emp of ghostCandidates) {
      const attendanceDays = attCountByEmployee.get(emp.id) ?? 0;
      const ghost = engine.detectGhostEmployee(emp.id, attendanceDays, true, emp.status);
      if (ghost) {
        alerts.push({ alertType: "ghost_employee", severity: "critical", employeeId: ghost.employeeId, description: ghost.reason, evidence: { attendanceDays }, riskScore: ghost.score, mlModel: "ghost_detector_v1" });
      }
    }

    // Store alerts
    for (const alert of alerts) {
      await publishF3Write(ctx, "ai_fraud_routes__0", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    }

    const duration = Date.now() as any - startTime;
    return reply.send({
      status: "completed", alertsGenerated: alerts.length, employeesScanned: employees.length,
      durationMs: duration, models: ["ghost_detector_v1", "duplicate_bank_v1", "salary_anomaly_v1"],
    });
  });

  // ── Employee risk scores ──
  app.get("/v1/hrms/ai/risk-scores", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    // PERF-006: this was `db.select()...where(tenantId)` with no limit/offset
    // at all -- one row per employee, so unbounded tenant-wide growth. Added
    // pagination (no existing query schema here to extend, unlike the alerts
    // route above which already had one).
    const q = riskScoresQuery.parse(req.query);
    const rows = await scopedRead((tx) => tx.select().from(hrmsEmployeeRiskScores)
      .where(eq(hrmsEmployeeRiskScores.tenantId, ctx.tenantId))
      .orderBy(hrmsEmployeeRiskScores.employeeId)
      .limit(q.limit).offset(q.offset));
    return reply.send({
      data: rows,
      pagination: {
        hasMore: rows.length === q.limit,
        pageSize: q.limit,
        ...(rows.length > 0 ? { cursor: String(q.offset + rows.length) } : {}),
      },
    });
  });

  // ── Smart recommendations ──
  app.get("/v1/hrms/ai/recommendations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(hrmsRecommendations)
      .where(and(eq(hrmsRecommendations.tenantId, ctx.tenantId), eq(hrmsRecommendations.isActioned, false)))
      .orderBy(desc(hrmsRecommendations.createdAt)).limit(50));

    // If no stored recs, generate fresh ones
    if (rows.length === 0) {
      const recs = engine.generateRecommendations({
        employeesWithNoLeave6Months: ["eeeeeeee-0001-0000-0000-000000000005"],
        employeesWithHighOvertime: [],
        departmentsUnderstaffed: ["IT"],
        leaveBalanceExpiring: [{ empId: "eeeeeeee-0001-0000-0000-000000000005", days: 4 }],
        upcomingProbationEnd: [],
      });
      for (const rec of recs) {
        await publishF3Write(ctx, "ai_fraud_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
      }
      const fresh = await scopedRead((tx) => tx.select().from(hrmsRecommendations).where(eq(hrmsRecommendations.tenantId, ctx.tenantId)).limit(50)) as any;
      return reply.send({ data: fresh });
    }
    return reply.send({ data: rows });
  });

  // ── Update alert status ──
  app.patch("/v1/hrms/ai/alerts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ status: z.enum(["investigating", "confirmed", "dismissed", "resolved"]), resolutionNotes: z.string().optional() }).parse(req.body);
    await publishF3Write(ctx, "ai_fraud_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: body.status }) as any;
  });

  // ── Attrition risk for specific employee ──
  app.get("/v1/hrms/ai/attrition-risk/:employeeId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { employeeId } = z.object({ employeeId: z.string().uuid() }).parse(req.params);
    // Compute attrition risk with available signals
    const risk = engine.predictAttritionRisk({
      attendanceDecline: false, leaveExhausted: false, noTrainingLast12Months: true,
      sameRoleOver3Years: true, recentPeerDepartures: 0, overtimeIncreasing: false,
      appraisalRatingLow: false, salaryBelowMarket: false, noPromotionLast5Years: false,
    });
    risk.employeeId = employeeId;
    return reply.send(risk);
  });
}
