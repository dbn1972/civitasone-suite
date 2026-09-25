import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { db } from "../../shared/db.js";
import { withTenantScope } from "@civitasone/db";
import { hrmsDepartments } from "../employee/schema.js";
import { inArray } from "drizzle-orm";

/**
 * HIGH finding: department scoping. `departmentId` is optional -- omitted,
 * this is unchanged tenant-wide behaviour (HR/admin callers). The cache hash
 * MUST vary by it: without this, a department-scoped caller's filtered
 * result and an HR/admin's tenant-wide result would collide on the same
 * `list:${limit}` cache key, serving one department's list to a manager in
 * another (or a stale scoped list to an HR/admin) for up to the cache TTL.
 * See routes.ts's GET /v1/hrms/job-openings handler for the resolveDeptScope
 * call this threads through from.
 */
export async function listJobOpenings(tenantId: string, limit: number, departmentId?: string) {
  return cache.listOrLoad(tenantId, "job_opening", `list:${limit}:${departmentId ?? "all"}`, async () => {
    const rows = await repo.listJobOpeningsByTenant(tenantId, limit, departmentId);
    const [appCounts, deptRows] = await Promise.all([
      repo.countApplicationsByJob(tenantId, rows.map((r) => r.id)),
      rows.length > 0
        ? (withTenantScope(db, tenantId, (tx) => (tx as typeof db).select({ id: hrmsDepartments.id, name: hrmsDepartments.name }).from(hrmsDepartments).where(inArray(hrmsDepartments.id, [...new Set(rows.map((r) => r.departmentId))]))) as Promise<{ id: string; name: string }[]>)
        : Promise.resolve([]),
    ]);
    const deptMap = new Map(deptRows.map((d) => [d.id, d.name]));
    return rows.map((r) => ({
      id: r.id,
      jobTitle: r.title,
      department: deptMap.get(r.departmentId) ?? r.departmentId.slice(0, 8),
      vacancies: r.vacancies,
      applicationDeadline: r.closesAt ?? undefined,
      // R-cancel / eOffice approve-reject / pending-approval statuses (see
      // publication-repo.ts updateVacancy + eoffice-consumer.ts updateJobOpening)
      // must never read as "open" here. Only "open" and "on_hold" pass through
      // as-is; every other real status (cancelled, rejected, approved,
      // pending_approval, and anything future) safely collapses to "closed" --
      // the previous default branch collapsed them all to "open", which would
      // have shown a cancelled/rejected/not-yet-approved vacancy as actively hiring.
      status: (r.status === "open" ? "open" : r.status === "on_hold" ? "on_hold" : "closed") as "open" | "closed" | "on_hold",
      applicationsReceived: appCounts.get(r.id) ?? 0,
      postedDate: r.postedAt ?? new Date(r.createdAt as unknown as string).toISOString().slice(0, 10),
      // CRITICAL fix: previously omitted here (and from JobOpeningSummarySchema),
      // so the detail page's Published/Not Published badge always read
      // `undefined` -- i.e. always "Not published" -- no matter the real DB
      // value, and a publish action's effect was never observable in the UI.
      isPublished: r.isPublished === true,
    }));
  });
}

/** Public: list open + published vacancies for a tenant (no auth needed). */
export async function listPublishedVacancies(tenantId: string) {
  const rows = await repo.listPublishedOpenings(tenantId);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    refNo: r.refNo,
    vacancyType: r.vacancyType,
    location: r.location,
    qualification: r.qualification,
    payRange: r.payRange,
    vacancies: r.vacancies,
    description: r.description,
    postedAt: r.postedAt ?? undefined,
    closesAt: r.closesAt ?? undefined,
  }));
}

/** Public: single vacancy detail (must be published + open). */
export async function getPublishedVacancy(id: string, tenantId: string) {
  const row = await repo.findPublishedOpening(id, tenantId);
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    refNo: row.refNo,
    vacancyType: row.vacancyType,
    location: row.location,
    qualification: row.qualification,
    payRange: row.payRange,
    vacancies: row.vacancies,
    description: row.description,
    postedAt: row.postedAt ?? undefined,
    closesAt: row.closesAt ?? undefined,
  };
}
