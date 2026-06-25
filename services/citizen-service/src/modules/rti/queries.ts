import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { RtiRow } from "./schema.js";

/** Cache JSON-roundtrips Date/timestamp columns to ISO strings; coerce safely. */
function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

/**
 * Re-coerce the cached row's date fields back to consistent ISO strings so a
 * cache HIT (JSON strings) and a cache MISS (Date objects) return identical
 * shapes to the API. Without this, `createdAt`/`updatedAt` leak as Date on a
 * miss and string on a hit. (P1-3/P1-4 read-model consistency.)
 */
function normalizeRtiDates<T extends RtiRow>(rti: T): T {
  return {
    ...rti,
    createdAt: toIso(rti.createdAt) as unknown as T["createdAt"],
    updatedAt: toIso(rti.updatedAt) as unknown as T["updatedAt"],
    deadline: String(rti.deadline) as unknown as T["deadline"],
  };
}

export async function getRti(tenantId: string, id: string): Promise<(RtiRow & { responses: Awaited<ReturnType<typeof repo.listResponses>>; appeals: Awaited<ReturnType<typeof repo.listAppeals>>; isOverdue: boolean; statusLabel: string }) | null> {
  const rti = await cache.getOrLoad<RtiRow | null>(
    cache.makeKey(tenantId, "rti", id),
    () => repo.findRtiById(id),
  );
  if (!rti || rti.tenantId !== tenantId) return null;
  const [responses, appeals] = await Promise.all([repo.listResponses(id), repo.listAppeals(id)]);
  const isOverdue = isRtiOverdue(rti);
  // P1-3: surface the mapped status label without breaking the raw `status` field.
  return { ...normalizeRtiDates(rti), responses, appeals, isOverdue, statusLabel: mapRtiStatus(rti.status) };
}

/** RTI Act 2005 §7: 30-day deadline — flag overdue if deadline has passed and no response given */
export function isRtiOverdue(rti: Pick<RtiRow, "deadline" | "status">, now = new Date()): boolean {
  if (rti.status === "responded" || rti.status === "appealed" || rti.status === "replied" || rti.status === "closed") return false;
  const deadline = new Date(rti.deadline.toString());
  return now > deadline;
}

/**
 * P1-3 read-model mapping. The write side (consumer) persists the DB vocabulary
 * `filed` / `responded` / `appealed` / `closed`. The previous mapper only knew
 * `forwarded`/`under_review`/`replied`/`appeal`/`closed`, so `responded` and
 * `appealed` BOTH fell through to the `received` default — a real status bug
 * where a replied/appealed RTI displayed as "received". Map the real DB codes
 * (and keep the legacy synonyms for forward-compat).
 */
export function mapRtiStatus(status: string): "received" | "forwarded" | "under_review" | "replied" | "appeal" | "closed" | "overdue" {
  switch (status) {
    case "filed": return "received";
    case "forwarded": return "forwarded";
    case "under_review": return "under_review";
    case "responded":
    case "replied": return "replied";
    case "appealed":
    case "appeal": return "appeal";
    case "closed": return "closed";
    default: return "received";
  }
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
      status: mapRtiStatus(row.status),
    }));
}
