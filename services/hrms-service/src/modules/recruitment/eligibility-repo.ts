import { eq, and, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { hrmsJobOpenings, hrmsApplications } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
type JobOpeningRow = typeof hrmsJobOpenings.$inferSelect;
type ApplicationRow = typeof hrmsApplications.$inferSelect;
type ApplicationInsert = typeof hrmsApplications.$inferInsert;

export async function findVacancy(tenantId: string, id: string): Promise<JobOpeningRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsJobOpenings)
    .where(and(eq(hrmsJobOpenings.tenantId, tenantId), eq(hrmsJobOpenings.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function setVacancyEligibility(
  tx: Writer, tenantId: string, id: string, eligibility: unknown, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsJobOpenings)
    .set({ eligibility: eligibility as never, version: sql`${hrmsJobOpenings.version} + 1`, updatedAt: new Date() })
    .where(and(eq(hrmsJobOpenings.tenantId, tenantId), eq(hrmsJobOpenings.id, id), eq(hrmsJobOpenings.version, expectedVersion)));
  if ((res as { rowCount?: number }).rowCount === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", "vacancy was modified by another request; reload and retry");
  }
}

/** Count non-withdrawn applications for this vacancy+email (case-insensitive
 *  duplicate pre-check; the DB unique index on dedup_key is the real guard). */
export async function countApplicationsForEmail(tenantId: string, jobOpeningId: string, email: string): Promise<number> {
  const rows = await scopedRead((tx) => tx
    .select({ n: sql<string>`count(*)` })
    .from(hrmsApplications)
    .where(and(
      eq(hrmsApplications.tenantId, tenantId),
      eq(hrmsApplications.jobOpeningId, jobOpeningId),
      sql`lower(${hrmsApplications.email}) = ${email.toLowerCase()}`,
      sql`${hrmsApplications.status} <> 'withdrawn'`,
    )));
  return Number(rows[0]?.n ?? "0");
}

export async function insertApplication(tx: Writer, row: ApplicationInsert): Promise<void> {
  await tx.insert(hrmsApplications).values(row);
}

export async function findApplication(tenantId: string, id: string): Promise<ApplicationRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsApplications)
    .where(and(eq(hrmsApplications.tenantId, tenantId), eq(hrmsApplications.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function withdrawApplication(
  tx: Writer, tenantId: string, id: string, reason: string, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsApplications)
    .set({ status: "withdrawn", withdrawReason: reason, version: sql`${hrmsApplications.version} + 1`, updatedAt: new Date() })
    .where(and(eq(hrmsApplications.tenantId, tenantId), eq(hrmsApplications.id, id), eq(hrmsApplications.version, expectedVersion)));
  if ((res as { rowCount?: number }).rowCount === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", "application was modified by another request; reload and retry");
  }
}
