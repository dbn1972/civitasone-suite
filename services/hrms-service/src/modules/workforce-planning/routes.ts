/**
 * Workforce Planning Module — READ-ONLY analytics
 *
 * Endpoints:
 *  GET /v1/hrms/workforce/headcount            — current headcount by dept/grade/type
 *  GET /v1/hrms/workforce/vacancy-forecast     — projected vacancies (retirements 1/3/5 years)
 *  GET /v1/hrms/workforce/retirement-forecast  — employees retiring by month/quarter/year
 *  GET /v1/hrms/workforce/budget               — position budget vs actual filled
 *  GET /v1/hrms/workforce/diversity            — SC/ST/OBC/EWS/PH composition vs mandate
 *
 * All queries are SQL aggregations against existing hrms.employees table.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { sqlClient } from "../../shared/db.js";
import { withRawTenantGuc } from "@civitasone/db";

const READER_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager", "finance_officer"];

/**
 * employee.hrms_employees / hrms_departments / hrms_designations all have RLS
 * ENABLEd and FORCEd, and this module talks to `sqlClient` directly (no
 * Drizzle schema here, so there is no `db.transaction()` — where
 * `wrapWithTenantGuc` injects `app.tenant_id` — in the call path). Without
 * this, every query below ran with no GUC set and the connecting role
 * (`hrms_svc`, NOBYPASSRLS non-superuser) got zero rows back, silently: RLS
 * fails CLOSED. See `@civitasone/db`'s `withRawTenantGuc` for the shared fix.
 */
function withTenantGuc<T>(
  tenantId: string,
  fn: (tx: typeof sqlClient) => Promise<T>,
): Promise<T> {
  return withRawTenantGuc(sqlClient, tenantId, fn);
}

export async function workforcePlanningRoutes(app: FastifyInstance): Promise<void> {
  // Current headcount by department, grade, employee type
  app.get("/v1/hrms/workforce/headcount", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const query = z.object({
      groupBy: z.enum(["department", "grade", "type"]).default("department"),
    }).parse(req.query);

    const rows = await withTenantGuc(ctx.tenantId, async (tx) => {
      if (query.groupBy === "department") {
        return tx`
          SELECT d.name AS group_key, COUNT(*)::int AS count
          FROM employee.hrms_employees e
          JOIN employee.hrms_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
          WHERE e.tenant_id = ${ctx.tenantId} AND e.status != 'separated'
          GROUP BY d.name ORDER BY count DESC
        `;
      } else if (query.groupBy === "grade") {
        return tx`
          SELECT COALESCE(dg.pay_grade, 'ungraded') AS group_key, COUNT(*)::int AS count
          FROM employee.hrms_employees e
          JOIN employee.hrms_designations dg ON dg.id = e.designation_id AND dg.tenant_id = e.tenant_id
          WHERE e.tenant_id = ${ctx.tenantId} AND e.status != 'separated'
          GROUP BY dg.pay_grade ORDER BY count DESC
        `;
      } else {
        return tx`
          SELECT employee_type AS group_key, COUNT(*)::int AS count
          FROM employee.hrms_employees
          WHERE tenant_id = ${ctx.tenantId} AND status != 'separated'
          GROUP BY employee_type ORDER BY count DESC
        `;
      }
    });

    const total = rows.reduce((s, r) => s + (r.count as number), 0);
    return reply.send({ data: { total, breakdown: rows } });
  });

  // Projected vacancies — retirements in next 1/3/5 years
  app.get("/v1/hrms/workforce/vacancy-forecast", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    // Superannuation age default: 60 years
    const retirementAge = 60;
    const rows = await withTenantGuc(ctx.tenantId, (tx) => tx`
      SELECT
        CASE
          WHEN (date_of_birth + INTERVAL '${tx.unsafe(String(retirementAge))} years') <= (CURRENT_DATE + INTERVAL '1 year') THEN '1_year'
          WHEN (date_of_birth + INTERVAL '${tx.unsafe(String(retirementAge))} years') <= (CURRENT_DATE + INTERVAL '3 years') THEN '3_years'
          WHEN (date_of_birth + INTERVAL '${tx.unsafe(String(retirementAge))} years') <= (CURRENT_DATE + INTERVAL '5 years') THEN '5_years'
          ELSE 'beyond_5_years'
        END AS horizon,
        COUNT(*)::int AS count
      FROM employee.hrms_employees
      WHERE tenant_id = ${ctx.tenantId}
        AND status != 'separated'
        AND date_of_birth IS NOT NULL
      GROUP BY horizon
      ORDER BY horizon
    `);

    return reply.send({ data: rows });
  });

  // Retirement forecast — employees retiring by month/quarter/year
  app.get("/v1/hrms/workforce/retirement-forecast", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const query = z.object({
      granularity: z.enum(["month", "quarter", "year"]).default("month"),
      years: z.coerce.number().int().min(1).max(10).default(3),
    }).parse(req.query);

    const retirementAge = 60;
    let groupExpr: string;
    if (query.granularity === "month") {
      groupExpr = "TO_CHAR(date_of_birth + INTERVAL '60 years', 'YYYY-MM')";
    } else if (query.granularity === "quarter") {
      groupExpr = "TO_CHAR(date_of_birth + INTERVAL '60 years', 'YYYY') || '-Q' || EXTRACT(QUARTER FROM date_of_birth + INTERVAL '60 years')";
    } else {
      groupExpr = "TO_CHAR(date_of_birth + INTERVAL '60 years', 'YYYY')";
    }

    const rows = await withTenantGuc(ctx.tenantId, (tx) => tx`
      SELECT
        ${tx.unsafe(groupExpr)} AS period,
        COUNT(*)::int AS retiring_count
      FROM employee.hrms_employees
      WHERE tenant_id = ${ctx.tenantId}
        AND status != 'separated'
        AND date_of_birth IS NOT NULL
        AND (date_of_birth + INTERVAL '${tx.unsafe(String(retirementAge))} years')
            BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '${tx.unsafe(String(query.years))} years')
      GROUP BY period
      ORDER BY period
    `);

    return reply.send({ data: rows });
  });

  // Position budget vs actual filled
  app.get("/v1/hrms/workforce/budget", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const rows = await sqlClient`
      SELECT
        d.name AS department,
        COALESCE(pb.sanctioned_positions, 0)::int AS sanctioned,
        COUNT(e.id)::int AS filled,
        GREATEST(COALESCE(pb.sanctioned_positions, 0) - COUNT(e.id)::int, 0)::int AS vacant
      FROM employee.hrms_departments d
      LEFT JOIN employee.position_budget pb
        ON pb.department_id = d.id AND pb.tenant_id = d.tenant_id
      LEFT JOIN employee.hrms_employees e
        ON e.department_id = d.id AND e.tenant_id = d.tenant_id AND e.status != 'separated'
      WHERE d.tenant_id = ${ctx.tenantId}
      GROUP BY d.name, pb.sanctioned_positions
      ORDER BY d.name
    `;

    return reply.send({ data: rows });
  });

  // Diversity — SC/ST/OBC/EWS/PH composition vs mandate
  app.get("/v1/hrms/workforce/diversity", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const rows = await sqlClient`
      SELECT
        COALESCE(ep.category, 'General') AS category,
        COUNT(*)::int AS count,
        ROUND(COUNT(*)::numeric * 100.0 / NULLIF(SUM(COUNT(*)) OVER(), 0), 2) AS percentage
      FROM employee.hrms_employees e
      LEFT JOIN employee.employee_profiles ep
        ON ep.employee_id = e.id AND ep.tenant_id = e.tenant_id
      WHERE e.tenant_id = ${ctx.tenantId} AND e.status != 'separated'
      GROUP BY ep.category
      ORDER BY count DESC
    `;

    // Mandated percentages per GOI reservation policy
    const mandates = [
      { category: "SC", mandatedPct: 15 },
      { category: "ST", mandatedPct: 7.5 },
      { category: "OBC", mandatedPct: 27 },
      { category: "EWS", mandatedPct: 10 },
      { category: "PH", mandatedPct: 4 },
    ];

    return reply.send({ data: { composition: rows, mandates } });
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
