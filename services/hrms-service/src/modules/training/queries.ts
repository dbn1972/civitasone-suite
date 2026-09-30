import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

/**
 * GAP-HR-TRAINING-05: a UTC calendar-date comparison put the "upcoming" /
 * "ongoing" cutover up to 5.5 hours off from what a viewer in India actually
 * sees -- e.g. at 00:30 IST on the 5th (still 19:00 UTC on the 4th), a
 * programme starting "today" (the 5th) still read as "upcoming" instead of
 * "ongoing". `en-CA` gives an unambiguous YYYY-MM-DD string directly, the
 * same Intl.DateTimeFormat pattern already used for this elsewhere in the
 * codebase (e.g. GAP-HR-TRANSFER-02's order-date fix).
 */
function todayInIst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function mapTrainingStatus(status: string, fromDate: string, toDate: string): "upcoming" | "ongoing" | "completed" | "cancelled" {
  if (status === "cancelled") return "cancelled";
  const today = todayInIst();
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
      // GAP-HR-TRAINING-02/NEW-02: real value from the row (migration
      // 0162), or null when HR genuinely never set one -- never a
      // hard-coded 'general' that the web layer used to relabel as
      // "Mandatory" for anything it didn't recognise.
      category: r.category ?? null,
      mode: r.mode ?? null,
      enrollmentDeadline: r.enrollmentDeadline ?? null,
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


/** Map a raw nomination status to the employee-facing approval state. */
function mapApprovalState(status: string): "pending" | "approved" | "waitlisted" | "rejected" | "completed" | "attended" {
  if (status === "nominated") return "pending";
  if (status === "approved" || status === "waitlisted" || status === "rejected"
      || status === "completed" || status === "attended") return status;
  return "pending";
}

/**
 * SVC-121/122 -- an employee's nominations with approval state and the linked
 * training / session info. Tenant-scoped and RLS-safe via repo.listNominationsByEmployee.
 */
export async function listMyNominations(tenantId: string, employeeId: string, limit = 100) {
  const rows = await repo.listNominationsByEmployee(tenantId, employeeId, limit);
  return rows.map((r) => ({
    id: r.id,
    employeeId,
    approvalState: mapApprovalState(r.status),
    status: r.status,
    trainingId: r.trainingId,
    trainingTitle: r.trainingTitle ?? undefined,
    startDate: r.trainingFromDate ?? undefined,
    endDate: r.trainingToDate ?? undefined,
    venue: r.trainingVenue ?? undefined,
    sessionId: r.sessionId ?? undefined,
    sessionTitle: r.sessionTitle ?? undefined,
    sessionDate: r.sessionDate ?? undefined,
    waitlistPosition: r.waitlistPosition ?? undefined,
    result: r.result ?? undefined,
    score: r.score ?? undefined,
    completedDate: r.completedDate ?? undefined,
  }));
}
