import { eq, and, desc, ilike, gte, sql, type SQL } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { hrmsJobOpenings, hrmsVacancyCorrigenda, type CorrigendumRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
type VacancyRow = typeof hrmsJobOpenings.$inferSelect;

export async function findVacancy(tenantId: string, id: string): Promise<VacancyRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsJobOpenings)
    .where(and(eq(hrmsJobOpenings.tenantId, tenantId), eq(hrmsJobOpenings.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function updateVacancy(
  tx: Writer, tenantId: string, id: string, patch: Partial<typeof hrmsJobOpenings.$inferInsert>, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsJobOpenings)
    .set({ ...patch, version: sql`${hrmsJobOpenings.version} + 1`, updatedAt: new Date() })
    .where(and(eq(hrmsJobOpenings.tenantId, tenantId), eq(hrmsJobOpenings.id, id), eq(hrmsJobOpenings.version, expectedVersion)));
  if (((res as { rowCount?: number; count?: number }).rowCount ?? (res as { count?: number }).count ?? 0) === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", "vacancy was modified by another request; reload and retry");
  }
}

export async function nextCorrigendumSeq(tenantId: string, jobOpeningId: string): Promise<number> {
  const rows = await scopedRead((tx) => tx.select({ m: sql<number>`COALESCE(MAX(${hrmsVacancyCorrigenda.seq}), 0)` })
    .from(hrmsVacancyCorrigenda)
    .where(and(eq(hrmsVacancyCorrigenda.tenantId, tenantId), eq(hrmsVacancyCorrigenda.jobOpeningId, jobOpeningId))));
  return Number(rows[0]?.m ?? 0) + 1;
}

export async function insertCorrigendum(
  tx: Writer,
  row: { tenantId: string; jobOpeningId: string; seq: number; action: string; changes: string; oldDeadline?: Date | null; newDeadline?: Date | null; actorId: string },
): Promise<void> {
  await tx.insert(hrmsVacancyCorrigenda).values({
    tenantId: row.tenantId, jobOpeningId: row.jobOpeningId, seq: row.seq, action: row.action,
    changes: row.changes, oldDeadline: row.oldDeadline ?? null, newDeadline: row.newDeadline ?? null, actorId: row.actorId,
  });
}

export async function listCorrigenda(tenantId: string, jobOpeningId: string): Promise<CorrigendumRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsVacancyCorrigenda)
    .where(and(eq(hrmsVacancyCorrigenda.tenantId, tenantId), eq(hrmsVacancyCorrigenda.jobOpeningId, jobOpeningId)))
    .orderBy(hrmsVacancyCorrigenda.seq));
}

/**
 * Public career search (R-RA-0071): published, non-cancelled vacancies filtered
 * by keyword / location / category (reservation-neutral vacancyType) / min
 * experience / employment type. Only 'public'/'both' portal-scoped vacancies.
 */
export async function searchVacancies(
  tenantId: string,
  f: { keyword?: string; location?: string; vacancyType?: string; minExperience?: number; internal?: boolean },
  limit = 100,
): Promise<VacancyRow[]> {
  const conds: SQL[] = [
    eq(hrmsJobOpenings.tenantId, tenantId),
    eq(hrmsJobOpenings.isPublished, "true"),
    eq(hrmsJobOpenings.status, "open"),
  ];
  conds.push(f.internal
    ? sql`${hrmsJobOpenings.portalScope} IN ('internal','both')`
    : sql`${hrmsJobOpenings.portalScope} IN ('public','both')`);
  if (f.keyword) conds.push(sql`(${ilike(hrmsJobOpenings.title, `%${f.keyword}%`)} OR ${ilike(hrmsJobOpenings.description, `%${f.keyword}%`)})`);
  if (f.location) conds.push(ilike(hrmsJobOpenings.location, `%${f.location}%`));
  if (f.vacancyType) conds.push(eq(hrmsJobOpenings.vacancyType, f.vacancyType));
  if (f.minExperience != null) conds.push(gte(hrmsJobOpenings.minExperienceYears, f.minExperience));
  return scopedRead((tx) => tx.select().from(hrmsJobOpenings)
    .where(and(...conds)).orderBy(desc(hrmsJobOpenings.postedAt)).limit(limit));
}
