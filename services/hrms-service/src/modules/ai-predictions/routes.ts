/**
 * AI Predictions Module
 *
 * Rule-based scoring — replace with ML model when training data available
 *
 * Endpoints:
 *  GET /v1/hrms/ai/attrition-risk    — employees at risk of leaving
 *  GET /v1/hrms/ai/succession        — recommended successors for key positions
 *  GET /v1/hrms/ai/workforce-insights — summary stats and trends
 *  GET /v1/hrms/ai/leave-prediction  — predicted leave utilization for next month
 *
 * Scoring logic:
 *  - Attrition: tenure < 2yr + no promotion in 3yr + low APAR score
 *  - Succession: same dept + higher APAR + right grade level
 *  - Leave prediction: based on historical patterns
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { sqlClient } from "../../shared/db.js";

const READER_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager"];

export async function aiPredictionsRoutes(app: FastifyInstance): Promise<void> {
  // Rule-based scoring — replace with ML model when training data available
  // Attrition risk: tenure < 2yr + no promotion in 3yr + low APAR score
  app.get("/v1/hrms/ai/attrition-risk", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(25),
      minScore: z.coerce.number().min(0).max(100).default(50),
    }).parse(req.query);

    // Rule-based scoring — replace with ML model when training data available
    // Risk factors:
    //   +40 if tenure < 2 years
    //   +30 if no promotion (designation change) in last 3 years
    //   +30 if latest APAR score < 60 (out of 100)
    const rows = await sqlClient`
      WITH risk_scores AS (
        SELECT
          e.id,
          e.employee_no,
          e.full_name,
          d.name AS department,
          dg.name AS designation,
          e.date_of_joining,
          EXTRACT(YEAR FROM AGE(CURRENT_DATE, e.date_of_joining::date)) AS tenure_years,
          (
            CASE WHEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, e.date_of_joining::date)) < 2 THEN 40 ELSE 0 END
            + CASE WHEN NOT EXISTS (
                SELECT 1 FROM employee.hrms_employees hist
                WHERE hist.id = e.id AND hist.updated_at > (CURRENT_DATE - INTERVAL '3 years')
                  AND hist.designation_id != e.designation_id
              ) THEN 30 ELSE 0 END
            + CASE WHEN COALESCE((
                SELECT score FROM employee.apar_records ar
                WHERE ar.employee_id = e.id AND ar.tenant_id = e.tenant_id
                ORDER BY ar.appraisal_year DESC LIMIT 1
              ), 70) < 60 THEN 30 ELSE 0 END
          ) AS risk_score
        FROM employee.hrms_employees e
        JOIN employee.hrms_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
        JOIN employee.hrms_designations dg ON dg.id = e.designation_id AND dg.tenant_id = e.tenant_id
        WHERE e.tenant_id = ${ctx.tenantId} AND e.status NOT IN ('separated', 'retired')
      )
      SELECT * FROM risk_scores
      WHERE risk_score >= ${query.minScore}
      ORDER BY risk_score DESC
      LIMIT ${query.limit}
    `;

    return reply.send({
      data: rows,
      meta: {
        algorithm: "rule-based",
        factors: ["tenure < 2yr (+40)", "no promotion in 3yr (+30)", "low APAR < 60 (+30)"],
        maxScore: 100,
      },
    });
  });

  // Rule-based scoring — replace with ML model when training data available
  // Succession: same dept + higher APAR + right grade level
  app.get("/v1/hrms/ai/succession", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const query = z.object({
      positionId: z.string().uuid().optional(),
      departmentId: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(10),
    }).parse(req.query);

    // Rule-based scoring — replace with ML model when training data available
    // Finds employees in same department at one grade level below
    // who have high APAR scores, sorted by suitability
    const rows = await sqlClient`
      WITH target_positions AS (
        SELECT DISTINCT e.department_id, dg.level AS target_level, dg.name AS position_name, e.id AS incumbent_id
        FROM employee.hrms_employees e
        JOIN employee.hrms_designations dg ON dg.id = e.designation_id AND dg.tenant_id = e.tenant_id
        WHERE e.tenant_id = ${ctx.tenantId}
          AND e.status NOT IN ('separated', 'retired')
          ${query.departmentId ? sqlClient`AND e.department_id = ${query.departmentId}` : sqlClient``}
          ${query.positionId ? sqlClient`AND e.id = ${query.positionId}` : sqlClient``}
          AND dg.level >= 5
      ),
      candidates AS (
        SELECT
          tp.position_name,
          tp.incumbent_id,
          e.id AS candidate_id,
          e.employee_no,
          e.full_name,
          d.name AS department,
          cdg.name AS current_designation,
          cdg.level AS candidate_level,
          tp.target_level,
          COALESCE((
            SELECT AVG(ar.score)::numeric(5,2) FROM employee.apar_records ar
            WHERE ar.employee_id = e.id AND ar.tenant_id = e.tenant_id
            ORDER BY ar.appraisal_year DESC LIMIT 3
          ), 0) AS avg_apar_score,
          EXTRACT(YEAR FROM AGE(CURRENT_DATE, e.date_of_joining::date)) AS tenure_years
        FROM employee.hrms_employees e
        JOIN employee.hrms_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
        JOIN employee.hrms_designations cdg ON cdg.id = e.designation_id AND cdg.tenant_id = e.tenant_id
        CROSS JOIN target_positions tp
        WHERE e.tenant_id = ${ctx.tenantId}
          AND e.status NOT IN ('separated', 'retired')
          AND e.department_id = tp.department_id
          AND cdg.level BETWEEN (tp.target_level - 2) AND (tp.target_level - 1)
          AND e.id != tp.incumbent_id
      )
      SELECT *,
        (avg_apar_score * 0.6 + LEAST(tenure_years, 20) * 2) AS suitability_score
      FROM candidates
      ORDER BY suitability_score DESC
      LIMIT ${query.limit}
    `;

    return reply.send({
      data: rows,
      meta: {
        algorithm: "rule-based",
        factors: ["same department", "grade level proximity", "APAR score (60%)", "tenure (40%)"],
      },
    });
  });

  // Workforce insights — summary stats and trends
  app.get("/v1/hrms/ai/workforce-insights", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    // Rule-based scoring — replace with ML model when training data available
    const [headcount] = await sqlClient`
      SELECT COUNT(*)::int AS total
      FROM employee.hrms_employees
      WHERE tenant_id = ${ctx.tenantId} AND status NOT IN ('separated', 'retired')
    `;

    const [avgTenure] = await sqlClient`
      SELECT ROUND(AVG(EXTRACT(YEAR FROM AGE(CURRENT_DATE, date_of_joining::date)))::numeric, 1) AS avg_years
      FROM employee.hrms_employees
      WHERE tenant_id = ${ctx.tenantId} AND status NOT IN ('separated', 'retired')
    `;

    const [retiringThisYear] = await sqlClient`
      SELECT COUNT(*)::int AS count
      FROM employee.hrms_employees
      WHERE tenant_id = ${ctx.tenantId}
        AND status NOT IN ('separated', 'retired')
        AND date_of_birth IS NOT NULL
        AND (date_of_birth + INTERVAL '60 years') BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '1 year')
    `;

    const joinsByMonth = await sqlClient`
      SELECT TO_CHAR(date_of_joining::date, 'YYYY-MM') AS month, COUNT(*)::int AS joins
      FROM employee.hrms_employees
      WHERE tenant_id = ${ctx.tenantId}
        AND date_of_joining::date >= (CURRENT_DATE - INTERVAL '12 months')
      GROUP BY month ORDER BY month
    `;

    const separationsByMonth = await sqlClient`
      SELECT TO_CHAR(updated_at, 'YYYY-MM') AS month, COUNT(*)::int AS separations
      FROM employee.hrms_employees
      WHERE tenant_id = ${ctx.tenantId}
        AND status = 'separated'
        AND updated_at >= (CURRENT_DATE - INTERVAL '12 months')
      GROUP BY month ORDER BY month
    `;

    return reply.send({
      data: {
        totalHeadcount: headcount?.total ?? 0,
        avgTenureYears: avgTenure?.avg_years ?? 0,
        retiringWithin1Year: retiringThisYear?.count ?? 0,
        trends: {
          joinsLast12Months: joinsByMonth,
          separationsLast12Months: separationsByMonth,
        },
      },
    });
  });

  // Rule-based scoring — replace with ML model when training data available
  // Leave prediction: based on historical patterns
  app.get("/v1/hrms/ai/leave-prediction", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const query = z.object({
      departmentId: z.string().uuid().optional(),
    }).parse(req.query);

    // Rule-based scoring — replace with ML model when training data available
    // Predict next month's leave based on same month in previous years
    const rows = await sqlClient`
      WITH historical AS (
        SELECT
          la.employee_id,
          EXTRACT(MONTH FROM la.start_date::date) AS leave_month,
          COUNT(*)::int AS leave_count,
          SUM(
            EXTRACT(DAY FROM (la.end_date::date - la.start_date::date)) + 1
          )::int AS total_days
        FROM employee.hrms_leave_apps la
        JOIN employee.hrms_employees e ON e.id = la.employee_id AND e.tenant_id = la.tenant_id
        WHERE la.tenant_id = ${ctx.tenantId}
          AND la.status = 'approved'
          ${query.departmentId ? sqlClient`AND e.department_id = ${query.departmentId}` : sqlClient``}
          AND la.start_date::date >= (CURRENT_DATE - INTERVAL '3 years')
        GROUP BY la.employee_id, leave_month
      )
      SELECT
        leave_month::int AS month,
        ROUND(AVG(leave_count)::numeric, 1) AS avg_leave_applications,
        ROUND(AVG(total_days)::numeric, 1) AS avg_leave_days,
        COUNT(DISTINCT employee_id)::int AS employees_with_history
      FROM historical
      WHERE leave_month = EXTRACT(MONTH FROM (CURRENT_DATE + INTERVAL '1 month'))
      GROUP BY leave_month
    `;

    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const nextMonthStr = nextMonth.toISOString().slice(0, 7);

    return reply.send({
      data: {
        predictedMonth: nextMonthStr,
        prediction: rows[0] ?? {
          month: nextMonth.getMonth() + 1,
          avg_leave_applications: 0,
          avg_leave_days: 0,
          employees_with_history: 0,
        },
        confidence: rows.length > 0 ? "medium" : "low",
        basis: "3-year historical pattern for same calendar month",
      },
      meta: {
        algorithm: "rule-based",
        note: "Based on historical leave patterns. Replace with ML model when training data available.",
      },
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
