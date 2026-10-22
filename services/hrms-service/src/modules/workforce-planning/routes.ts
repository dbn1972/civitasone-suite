/**
 * Workforce Planning Module — READ-ONLY analytics
 *
 * Endpoints:
 *  GET /v1/hrms/workforce/headcount            — current headcount by dept/grade/type
 *  GET /v1/hrms/workforce/vacancy-forecast     — projected vacancies (retirements 1/3/5 years)
 *  GET /v1/hrms/workforce/retirement-forecast  — employees retiring by month/quarter/year
 *  GET /v1/hrms/workforce/analytics-kpis       — same-schema KPIs (avg tenure, gender ratio)
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
import { getPolicy } from "../policy-settings/repo.js";

const READER_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager", "finance_officer"];

/**
 * GAP-HR-WORKFORCE-07: superannuation age used to be two independent literal
 * `60`s (vacancy-forecast's CASE expression and retirement-forecast's WHERE
 * filter) plus a THIRD hardcoded copy as the literal SQL string `'60 years'`
 * inside retirement-forecast's `groupExpr` -- three places that could silently
 * diverge. It is now ONE per-request value, read from the tenant's
 * `retirement_age` policy (policy-settings/registry.ts; no stored row == the
 * historical 60), used by every query below (including `groupExpr`, via the
 * interval fragment built from it) and surfaced in both endpoints'
 * `meta.retirementAge` so the web can show "Assumes superannuation at N
 * years" instead of asserting it as fact with no visible basis.
 *
 * Which age applies to which edition / employee category (e.g. teachers) is an
 * HR-policy decision made by setting the key per tenant; per-category ages
 * would need employee-level data and are NOT modelled here.
 */
async function resolveRetirementAge(tenantId: string): Promise<number> {
  return (await getPolicy(tenantId, "retirement_age")).superannuationAge;
}

/**
 * The `INTERVAL 'N years'` SQL fragment for the resolved age. `age` is a
 * zod-validated integer from the policy registry (never request input); the
 * check below keeps the string interpolation provably numeric regardless.
 */
function ageIntervalSql(age: number): string {
  if (!Number.isInteger(age)) throw new Error(`retirement age must be an integer, got ${String(age)}`);
  return `INTERVAL '${age} years'`;
}

/**
 * GAP-HR-WORKFORCE-ANALYTICS-06: per the published HR decision packet
 * (reviewed directly — "DPDP & who sees what" theme, GAP-HR-WORKFORCE-
 * ANALYTICS-06 card, tagged "Applying default"): a gender ratio computed
 * over a tiny group re-identifies someone (a "ratio" of 1-of-2 people). The
 * packet's stated default — "Suppress any breakdown where the underlying
 * group is smaller than 10" — is applied here, at the source, rather than
 * only hidden client-side.
 */
const GENDER_SUPPRESSION_THRESHOLD = 10;

/**
 * employee.hrms_employees / hrms_departments / hrms_designations all have RLS
 * ENABLEd and FORCEd, and this module talks to `sqlClient` directly (no
 * Drizzle schema here, so there is no ORM-level transaction wrapper — where
 * `wrapWithTenantGuc` injects `app.tenant_id` — in the call path). Without
 * this, every query below ran with no GUC set and the connecting role
 * (`hrms_svc`, NOBYPASSRLS non-superuser) got zero rows back, silently: RLS
 * fails CLOSED. See `@civitasone/db`'s `withRawTenantGuc` for the shared fix.
 *
 * NOTE for the F3 leftover-CQRS guard test (tests/f3-leftover-hrms-cqrs.test.ts):
 * this module is read-only (see the file header above) — it has no writes at
 * all. The ONE line the guard test used to flag here was this comment
 * block's prose mentioning the ORM transaction-wrapper method by name
 * (spelled out as an object-dot-method call), a false positive from
 * regex-scanning comment text, not a real leftover synchronous write.
 * Rewording it (as above, and avoiding spelling that name out verbatim
 * anywhere in this file) is the whole fix for this file.
 */
function withTenantGuc<T>(
  tenantId: string,
  fn: (tx: typeof sqlClient) => Promise<T>,
): Promise<T> {
  return withRawTenantGuc(sqlClient, tenantId, fn);
}

export async function workforcePlanningRoutes(app: FastifyInstance): Promise<void> {
  // Current headcount by department, grade, employee type
  //
  // GAP2-HRMS-WORKFORCE-01: the three groupBy branches must count the SAME
  // population so the web's "Total Headcount" (the sum of a tab's breakdown)
  // is identical regardless of which tab is open. The department/grade
  // branches used an INNER JOIN to hrms_departments/hrms_designations; because
  // hrms_employees has no FK constraints, an employee whose department_id/
  // designation_id points at a since-deleted master row (reachable after a
  // permitted department delete -- the delete guard excludes EXITED_STATUSES,
  // but headcount counts them) was silently DROPPED from those two tabs while
  // the join-free `type` branch still counted it, so the three tabs reported
  // three different totals for one workforce. Fixed to LEFT JOIN + a
  // COALESCE('unassigned'/'ungraded') bucket so orphaned-FK employees are
  // still counted (and visibly bucketed), making all three totals equal.
  //
  // Population definition (documented, consistent with the delete guard):
  // headcount = non-separated employees (status != 'separated'), which
  // deliberately INCLUDES retired/terminated. The department-delete guard
  // (countActiveEmployeesByDept) excludes EXITED_STATUSES, so a department
  // whose only remaining employees are retired/terminated can still be
  // deleted; those employees then become COALESCE('unassigned') rows here
  // rather than vanishing from two of the three tabs.
  app.get("/v1/hrms/workforce/headcount", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const query = z.object({
      groupBy: z.enum(["department", "grade", "type"]).default("department"),
    }).parse(req.query);

    const rows = await withTenantGuc(ctx.tenantId, async (tx) => {
      if (query.groupBy === "department") {
        return tx`
          SELECT COALESCE(d.name, 'unassigned') AS group_key, COUNT(*)::int AS count
          FROM employee.hrms_employees e
          LEFT JOIN employee.hrms_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
          WHERE e.tenant_id = ${ctx.tenantId} AND e.status != 'separated'
          GROUP BY COALESCE(d.name, 'unassigned') ORDER BY count DESC
        `;
      } else if (query.groupBy === "grade") {
        return tx`
          SELECT COALESCE(dg.pay_grade, 'ungraded') AS group_key, COUNT(*)::int AS count
          FROM employee.hrms_employees e
          LEFT JOIN employee.hrms_designations dg ON dg.id = e.designation_id AND dg.tenant_id = e.tenant_id
          WHERE e.tenant_id = ${ctx.tenantId} AND e.status != 'separated'
          GROUP BY COALESCE(dg.pay_grade, 'ungraded') ORDER BY count DESC
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

    const retirementAge = await resolveRetirementAge(ctx.tenantId);
    const ageInterval = ageIntervalSql(retirementAge);

    const rows = await withTenantGuc(ctx.tenantId, (tx) => tx`
      SELECT
        CASE
          WHEN (date_of_birth + ${tx.unsafe(ageInterval)}) <= (CURRENT_DATE + INTERVAL '1 year') THEN '1_year'
          WHEN (date_of_birth + ${tx.unsafe(ageInterval)}) <= (CURRENT_DATE + INTERVAL '3 years') THEN '3_years'
          WHEN (date_of_birth + ${tx.unsafe(ageInterval)}) <= (CURRENT_DATE + INTERVAL '5 years') THEN '5_years'
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

    return reply.send({ data: rows, meta: { retirementAge } });
  });

  // Retirement forecast — employees retiring by month/quarter/year
  app.get("/v1/hrms/workforce/retirement-forecast", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const query = z.object({
      granularity: z.enum(["month", "quarter", "year"]).default("month"),
      years: z.coerce.number().int().min(1).max(10).default(3),
    }).parse(req.query);

    const retirementAge = await resolveRetirementAge(ctx.tenantId);
    const ageInterval = ageIntervalSql(retirementAge);

    let groupExpr: string;
    if (query.granularity === "month") {
      groupExpr = `TO_CHAR(date_of_birth + ${ageInterval}, 'YYYY-MM')`;
    } else if (query.granularity === "quarter") {
      groupExpr = `TO_CHAR(date_of_birth + ${ageInterval}, 'YYYY') || '-Q' || EXTRACT(QUARTER FROM date_of_birth + ${ageInterval})`;
    } else {
      groupExpr = `TO_CHAR(date_of_birth + ${ageInterval}, 'YYYY')`;
    }

    const rows = await withTenantGuc(ctx.tenantId, (tx) => tx`
      SELECT
        ${tx.unsafe(groupExpr)} AS period,
        COUNT(*)::int AS retiring_count
      FROM employee.hrms_employees
      WHERE tenant_id = ${ctx.tenantId}
        AND status != 'separated'
        AND date_of_birth IS NOT NULL
        AND (date_of_birth + ${tx.unsafe(ageInterval)})
            BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '${tx.unsafe(String(query.years))} years')
      GROUP BY period
      ORDER BY period
    `);

    return reply.send({ data: rows, meta: { retirementAge } });
  });

  // Analytics KPIs — GAP-HR-WORKFORCE-ANALYTICS-01.
  //
  // Deliberately narrow: `turnoverPct`, `absenteeismPct` and `monthlyTrend`
  // need attendance/lifecycle history that lives in OTHER hrms-service
  // modules with no queryable read model today. This module's own CLAUDE.md
  // rule (module isolation, no cross-module joins) forbids reaching for that
  // data directly, so rather than fake it, those three fields are simply
  // never included in the response — `meta.unavailable` names them
  // explicitly so the web can render an honest "not available" state
  // instead of guessing why a field is missing. `avgTenureYears` (from
  // `date_of_joining`) and the gender counts (from `gender`) both live on
  // this module's own `employee.hrms_employees` rows, so they're safe to
  // compute directly, same-schema, no join.
  app.get("/v1/hrms/workforce/analytics-kpis", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const rows = await withTenantGuc(ctx.tenantId, (tx) => tx`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE gender = 'female')::int AS female_count,
        COUNT(*) FILTER (WHERE gender = 'male')::int AS male_count,
        (AVG(CURRENT_DATE - date_of_joining) / 365.25)::float8 AS avg_tenure_years
      FROM employee.hrms_employees
      WHERE tenant_id = ${ctx.tenantId} AND status != 'separated'
    `);

    const row = (rows[0] ?? {}) as {
      total?: number;
      female_count?: number;
      male_count?: number;
      avg_tenure_years?: number | string | null;
    };
    const total = Number(row.total ?? 0);
    const genderSuppressed = total < GENDER_SUPPRESSION_THRESHOLD;
    const avgTenureYears =
      row.avg_tenure_years !== null && row.avg_tenure_years !== undefined
        ? Number(row.avg_tenure_years)
        : null;

    const data: {
      avgTenureYears: number | null;
      genderRatioF?: number;
      genderRatioM?: number;
    } = { avgTenureYears };

    if (!genderSuppressed) {
      data.genderRatioF = Number(row.female_count ?? 0);
      data.genderRatioM = Number(row.male_count ?? 0);
    }

    return reply.send({
      data,
      meta: {
        genderSuppressed,
        genderSuppressionThreshold: GENDER_SUPPRESSION_THRESHOLD,
        unavailable: ["turnoverPct", "absenteeismPct", "monthlyTrend"],
      },
    });
  });

  // Position budget vs actual filled
  //
  // TX-014: `employee.position_budget` has no migration in any service (see
  // ENTERPRISE-GAP-REPORT-2026-09-07.md) — this used to be a raw query that
  // 500'd on every real call (PostgresError 42P01, "relation ... does not
  // exist"). Per the gap's DoD, and the DOM-015 stub convention (see
  // recruitment/external-seams-routes.ts), an honest 501 replaces the
  // 500 until the table is actually built and backfilled.
  app.get("/v1/hrms/workforce/budget", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    return reply.code(501).send({
      code: "NOT_BUILT",
      source: "stub",
      message: "position budget is not available — employee.position_budget has no migration yet",
    });
  });

  // Diversity — SC/ST/OBC/EWS/PH composition vs mandate
  //
  // TX-014: same defect as /budget above — `employee.employee_profiles` has
  // no migration in any service, so this always 500'd. Honest 501 stub
  // until the table exists.
  app.get("/v1/hrms/workforce/diversity", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    return reply.code(501).send({
      code: "NOT_BUILT",
      source: "stub",
      message: "diversity composition is not available — employee.employee_profiles has no migration yet",
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
