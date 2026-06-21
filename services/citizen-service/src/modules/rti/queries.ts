import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { RtiRow } from "./schema.js";

export async function getRti(tenantId: string, id: string): Promise<(RtiRow & { responses: Awaited<ReturnType<typeof repo.listResponses>>; appeals: Awaited<ReturnType<typeof repo.listAppeals>> }) | null> {
  const rti = await cache.getOrLoad<RtiRow | null>(
    cache.makeKey(tenantId, "rti", id),
    () => repo.findRtiById(id),
  );
  if (!rti || rti.tenantId !== tenantId) return null;
  const [responses, appeals] = await Promise.all([repo.listResponses(id), repo.listAppeals(id)]);
  return { ...rti, responses, appeals };
}

function mapRtiStatus(status: string): "received" | "forwarded" | "under_review" | "replied" | "appeal" | "closed" {
  if (status === "forwarded") return "forwarded";
  if (status === "under_review") return "under_review";
  if (status === "replied") return "replied";
  if (status === "appeal") return "appeal";
  if (status === "closed") return "closed";
  return "received";
}

export async function listRtiSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "rti_list", `list:${limit}`),
    () => repo.listRtiByTenant(tenantId, limit),
  );
  return (rows ?? []).map((row) => ({
    id: row.id,
    rtiNo: row.rtiNo,
    applicantName: row.citizenId ?? "Citizen",
    subject: row.subject,
    filedDate: row.createdAt.toISOString().slice(0, 10),
    deadlineDate: row.deadline.toString(),
    status: mapRtiStatus(row.status),
  }));
}
