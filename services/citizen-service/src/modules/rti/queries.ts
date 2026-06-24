import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { RtiRow } from "./schema.js";

export async function getRti(tenantId: string, id: string): Promise<(RtiRow & { responses: Awaited<ReturnType<typeof repo.listResponses>>; appeals: Awaited<ReturnType<typeof repo.listAppeals>>; isOverdue: boolean }) | null> {
  const rti = await cache.getOrLoad<RtiRow | null>(
    cache.makeKey(tenantId, "rti", id),
    () => repo.findRtiById(id),
  );
  if (!rti || rti.tenantId !== tenantId) return null;
  const [responses, appeals] = await Promise.all([repo.listResponses(id), repo.listAppeals(id)]);
  const isOverdue = isRtiOverdue(rti);
  return { ...rti, responses, appeals, isOverdue };
}

/** RTI Act 2005 §7: 30-day deadline — flag overdue if deadline has passed and no response given */
export function isRtiOverdue(rti: Pick<RtiRow, "deadline" | "status">, now = new Date()): boolean {
  if (rti.status === "responded" || rti.status === "appealed") return false;
  const deadline = new Date(rti.deadline.toString());
  return now > deadline;
}

function mapRtiStatus(status: string): "received" | "forwarded" | "under_review" | "replied" | "appeal" | "closed" | "overdue" {
  if (status === "forwarded") return "forwarded";
  if (status === "under_review") return "under_review";
  if (status === "replied") return "replied";
  if (status === "appeal") return "appeal";
  if (status === "closed") return "closed";
  return "received";
}

export async function listRtiSummaries(tenantId: string, limit: number, citizenId?: string) {
  // P0-1: a bare citizen only sees their own RTIs; officers see the tenant view.
  const rows = citizenId
    ? await repo.listRtiByCitizen(tenantId, citizenId, limit)
    : await cache.getOrLoad(
        cache.makeKey(tenantId, "rti_list", `list:${limit}`),
        () => repo.listRtiByTenant(tenantId, limit),
      );
  const now = new Date();
  return (rows ?? []).map((row) => ({
    id: row.id,
    rtiNo: row.rtiNo,
    applicantName: row.citizenId ?? "Citizen",
    subject: row.subject,
    filedDate: new Date(row.createdAt as unknown as string).toISOString().slice(0, 10),
    deadlineDate: row.deadline.toString(),
    status: mapRtiStatus(row.status),
    /** RTI Act 2005 §7: flag if 30-day deadline has passed without response */
    isOverdue: isRtiOverdue(row, now),
    isFirstAppeal: false,
  }));
}

/** Return only RTI requests whose 30-day deadline has passed and no response given. */
export async function listOverdueRti(tenantId: string) {
  const rows = await repo.listRtiByTenant(tenantId, 500);
  const now = new Date();
  return rows
    .filter((row) => isRtiOverdue(row, now))
    .map((row) => ({
      id: row.id,
      rtiNo: row.rtiNo,
      subject: row.subject,
      deadline: row.deadline.toString(),
      daysPastDeadline: Math.floor((now.getTime() - new Date(row.deadline.toString()).getTime()) / (1000 * 60 * 60 * 24)),
      cpioRef: row.cpioRef,
      status: row.status,
    }));
}
