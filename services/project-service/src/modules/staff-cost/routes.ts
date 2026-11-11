/**
 * S8 G7: project staff-cost TOTALS for a project manager.
 *
 *   GET /v1/projects/:id/staff-cost?from=YYYY-MM&to=YYYY-MM
 *   GET /v1/projects/costing-index
 *
 * ACCESS (owner decision 10 Nov 2026): a project manager sees what their
 * project's staff cost in total, never what any person earns. Enforced here in
 * the API, and below it in the data: the postings table holds aggregates only,
 * and the response is built field by field (no row spreading), so an added
 * column cannot leak by accident. A project manager is a MEMBER of the project
 * with role project_manager; a global project_manager role alone is not enough.
 */
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../shared/db.js";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

/** May read any project's cost totals in the tenant. */
const TENANT_WIDE_ROLES = ["super_admin", "finance_officer", "audit_officer", "finance_admin"];
const PROJECT_MANAGER_ROLES = ["project_manager", "project_officer"];
/** Needs the project -> cost centre index to fill an allocation form (no pay data in it). */
const INDEX_ROLES = [...TENANT_WIDE_ROLES, ...PROJECT_MANAGER_ROLES, "payroll_admin", "payroll_officer", "hr_admin"];

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "must be YYYY-MM");
const query = z.object({ from: period, to: period }).refine((q) => q.from <= q.to, "from must not be after to");

type Row = Record<string, string | number | null>;
const rowsOf = (r: unknown): Row[] => Array.from(r as Iterable<Row>);

export async function staffCostRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/projects/costing-index", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INDEX_ROLES);
    const rows = rowsOf(await db.transaction((tx) => tx.execute(sql`
      SELECT id, code, name, cost_center_id, status FROM project.project_projects
       WHERE tenant_id = ${ctx.tenantId}::uuid ORDER BY code LIMIT 1000`)));
    return reply.send({ data: rows.map((r) => ({ projectId: r.id, code: r.code, name: r.name, costCenterId: r.cost_center_id, status: r.status })) });
  });

  app.get("/v1/projects/:id/staff-cost", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_WIDE_ROLES, ...PROJECT_MANAGER_ROLES]);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const q = query.parse(req.query);

    const out = await db.transaction(async (tx) => {
      const project = rowsOf(await tx.execute(sql`
        SELECT id, code, name, cost_center_id FROM project.project_projects WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid`))[0];
      if (!project) return { notFound: true as const };
      const wide = TENANT_WIDE_ROLES.some((r) => ctx.roles.includes(r));
      if (!wide) {
        const mgr = rowsOf(await tx.execute(sql`
          SELECT 1 AS ok FROM project.project_members
           WHERE project_id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid AND user_id = ${ctx.actorId}::uuid AND role = 'project_manager'`));
        if (mgr.length === 0) return { forbidden: true as const };
      }
      const periods = rowsOf(await tx.execute(sql`
        SELECT cost_month, SUM(gross_minor)::text AS gross, SUM(employer_cost_minor)::text AS employer, SUM(total_cost_minor)::text AS total,
               COALESCE(SUM(headcount) FILTER (WHERE kind = 'run'), 0)::int AS heads
          FROM project.project_staff_cost_postings
         WHERE tenant_id = ${ctx.tenantId}::uuid AND project_id = ${id}::uuid AND cost_month BETWEEN ${q.from} AND ${q.to}
         GROUP BY cost_month ORDER BY cost_month`));
      return { project, periods };
    });
    if ("notFound" in out) throw new HttpError(404, "NOT_FOUND", "project not found");
    if ("forbidden" in out) throw new HttpError(403, "NOT_PROJECT_MANAGER", "only the project's manager or finance can see its staff cost");

    const list = out.periods.map((r) => ({
      period: r.cost_month as string, grossMinor: r.gross as string, employerCostMinor: r.employer as string,
      totalCostMinor: r.total as string, headcount: Number(r.heads),
    }));
    const sum = (k: "grossMinor" | "employerCostMinor" | "totalCostMinor") => list.reduce((s, x) => s + BigInt(x[k]), 0n).toString();
    return reply.send({
      projectId: out.project.id, projectCode: out.project.code, from: q.from, to: q.to, currency: "INR",
      periods: list,
      totals: { grossMinor: sum("grossMinor"), employerCostMinor: sum("employerCostMinor"), totalCostMinor: sum("totalCostMinor") },
    });
  });
}
