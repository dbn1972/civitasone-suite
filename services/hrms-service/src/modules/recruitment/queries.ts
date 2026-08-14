import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { db } from "../../shared/db.js";
import { withTenantScope } from "@civitasone/db";
import { hrmsDepartments } from "../employee/schema.js";
import { inArray } from "drizzle-orm";

export async function listJobOpenings(tenantId: string, limit: number) {
  return cache.listOrLoad(tenantId, "job_opening", `list:${limit}`, async () => {
    const rows = await repo.listJobOpeningsByTenant(tenantId, limit);
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
      status: (r.status === "closed" ? "closed" : r.status === "on_hold" ? "on_hold" : "open") as "open" | "closed" | "on_hold",
      applicationsReceived: appCounts.get(r.id) ?? 0,
      postedDate: r.postedAt ?? new Date(r.createdAt as unknown as string).toISOString().slice(0, 10),
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
