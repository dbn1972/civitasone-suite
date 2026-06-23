import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

export async function listJobOpenings(tenantId: string, limit: number) {
  return cache.listOrLoad(tenantId, "job_opening", `list:${limit}`, async () => {
    const rows = await repo.listJobOpeningsByTenant(tenantId, limit);
    const appCounts = await repo.countApplicationsByJob(tenantId, rows.map((r) => r.id));
    return rows.map((r) => ({
      id: r.id,
      jobTitle: r.title,
      department: r.departmentId.slice(0, 8),
      vacancies: r.vacancies,
      applicationDeadline: r.closesAt ?? undefined,
      status: (r.status === "closed" ? "closed" : r.status === "on_hold" ? "on_hold" : "open") as "open" | "closed" | "on_hold",
      applicationsReceived: appCounts.get(r.id) ?? 0,
      postedDate: r.postedAt ?? new Date(r.createdAt as unknown as string).toISOString().slice(0, 10),
    }));
  });
}
