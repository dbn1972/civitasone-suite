/**
 * Employee name lookup for payroll screens (GAP-PAYROLL-LOANS-01,
 * GAP-PAYROLL-FNF-05): "pick an employee by name / code" must work for a
 * payroll_admin / payroll_officer / finance_officer who has no access to the
 * HRMS employee directory (DIRECTORY_ROLES in hrms-service), otherwise the
 * picker is empty for exactly the people who operate payroll.
 *
 *   GET /v1/payroll/employee-lookup?q=<text>&limit=<n>
 *   GET /v1/payroll/employee-lookup?ids=<uuid,uuid,...>
 *
 * Tenant-scoped through hrms-service's internal employee-summaries feed (the
 * same display-enrichment source slips and the run register use). Returns
 * only id / employeeNo / name / department -- no contact details, no PAN, no
 * bank data. Bounded: at most 50 rows per call. Read-only; no audit event
 * (the same directory data the slip lists already show to these roles).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";
import { searchEmployeeSummaries } from "../../shared/hrms-client.js";

export const LOOKUP_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"];

const query = z.object({
  q: z.string().trim().max(100).optional(),
  ids: z.string().max(2000).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type EmployeeLookupRow = { id: string; employeeNo: string | null; name: string; department: string };

export function filterEmployees(
  all: Map<string, { fullName: string; departmentName: string; employeeNo: string | null }>,
  opts: { q?: string | undefined; ids?: string[] | undefined; limit: number },
): EmployeeLookupRow[] {
  const rows: EmployeeLookupRow[] = [];
  const needle = opts.q?.toLowerCase();
  const idSet = opts.ids ? new Set(opts.ids) : null;
  for (const [id, e] of all) {
    if (idSet && !idSet.has(id)) continue;
    if (needle && !(e.fullName.toLowerCase().includes(needle) || (e.employeeNo ?? "").toLowerCase().includes(needle))) continue;
    rows.push({ id, employeeNo: e.employeeNo, name: e.fullName, department: e.departmentName });
  }
  // Stable order: name, then id.
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return rows.slice(0, opts.limit);
}

export async function employeeLookupRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/employee-lookup", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LOOKUP_ROLES);
    const q = query.parse(req.query ?? {});
    const ids = q.ids
      ? q.ids.split(",").map((s) => s.trim()).filter((s) => z.string().uuid().safeParse(s).success).slice(0, 50)
      : undefined;
    const all = await searchEmployeeSummaries(ctx.tenantId, { q: q.q, ids });
    const data = filterEmployees(all, { q: q.q, ids, limit: q.limit });
    return reply.send({ data, meta: { limit: q.limit } });
  });
}
