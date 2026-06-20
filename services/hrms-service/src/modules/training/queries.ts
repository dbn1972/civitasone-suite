import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

function mapTrainingStatus(status: string, fromDate: string, toDate: string): "upcoming" | "ongoing" | "completed" | "cancelled" {
  if (status === "cancelled") return "cancelled";
  const today = new Date().toISOString().slice(0, 10);
  if (today < fromDate) return "upcoming";
  if (today > toDate) return "completed";
  return "ongoing";
}

export async function listTrainingPrograms(tenantId: string, limit: number) {
  return cache.listOrLoad(tenantId, "training", `list:${limit}`, async () => {
    const rows = await repo.listTrainingsByTenant(tenantId, limit);
    const enrolled = await repo.countNominationsByTraining(tenantId, rows.map((r) => r.id));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      category: "general",
      trainerName: r.facilitator ?? undefined,
      startDate: r.fromDate,
      endDate: r.toDate,
      venue: r.venue ?? undefined,
      enrolledCount: enrolled.get(r.id) ?? 0,
      maxCapacity: r.maxParticipants,
      status: mapTrainingStatus(r.status, r.fromDate, r.toDate),
    }));
  });
}
