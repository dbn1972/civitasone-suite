import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { db, scopedRead} from "../../shared/db.js";
import { hrmsJobOpenings, hrmsApplications, hrmsOffers, hrmsInterviews, type ApplicationRow, type JobOpeningRow, type InterviewRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findApplicationById(id: string, tenantId: string): Promise<ApplicationRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsApplications)
    .where(and(eq(hrmsApplications.id, id), eq(hrmsApplications.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

export async function insertJobOpening(tx: Writer, row: typeof hrmsJobOpenings.$inferInsert): Promise<void> {
  await tx.insert(hrmsJobOpenings).values(row);
}

export async function insertApplication(tx: Writer, row: typeof hrmsApplications.$inferInsert): Promise<void> {
  await tx.insert(hrmsApplications).values(row);
}

export async function updateApplication(tx: Writer, id: string, patch: Partial<typeof hrmsApplications.$inferInsert>): Promise<void> {
  await tx.update(hrmsApplications).set({ ...patch, updatedAt: new Date() }).where(eq(hrmsApplications.id, id));
}

export async function insertOffer(tx: Writer, row: typeof hrmsOffers.$inferInsert): Promise<void> {
  await tx.insert(hrmsOffers).values(row);
}

export async function listJobOpeningsByTenant(tenantId: string, limit = 100): Promise<JobOpeningRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsJobOpenings)
    .where(eq(hrmsJobOpenings.tenantId, tenantId))
    .limit(limit));
}

export async function countApplicationsByJob(tenantId: string, jobIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (jobIds.length === 0) return counts;
  const rows = await db
    .select({
      jobOpeningId: hrmsApplications.jobOpeningId,
      count: sql<number>`count(*)::int`,
    })
    .from(hrmsApplications)
    .where(and(eq(hrmsApplications.tenantId, tenantId), inArray(hrmsApplications.jobOpeningId, jobIds)))
    .groupBy(hrmsApplications.jobOpeningId);
  for (const row of rows) counts.set(row.jobOpeningId, row.count);
  return counts;
}

// --- Interviews (P0-2: persisted in recruitment.hrms_interviews) ---

export async function insertInterview(tx: Writer, row: typeof hrmsInterviews.$inferInsert): Promise<void> {
  await tx.insert(hrmsInterviews).values(row);
}

export async function findInterviewById(id: string, tenantId: string): Promise<InterviewRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsInterviews)
    .where(and(eq(hrmsInterviews.id, id), eq(hrmsInterviews.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

export async function listInterviews(
  tenantId: string,
  filters: { jobOpeningId?: string; applicationId?: string },
  limit = 50,
): Promise<InterviewRow[]> {
  const conds = [eq(hrmsInterviews.tenantId, tenantId)];
  if (filters.jobOpeningId) conds.push(eq(hrmsInterviews.jobOpeningId, filters.jobOpeningId));
  if (filters.applicationId) conds.push(eq(hrmsInterviews.applicationId, filters.applicationId));
  return scopedRead((tx) => tx.select().from(hrmsInterviews)
    .where(and(...conds))
    .orderBy(desc(hrmsInterviews.scheduledDate))
    .limit(limit));
}

export async function updateInterviewScorecard(
  tx: Writer,
  id: string,
  tenantId: string,
  scorecard: Record<string, unknown>,
  recommendation: string | null,
): Promise<void> {
  await tx.update(hrmsInterviews)
    .set({ scorecard, status: "completed", ...(recommendation ? { recommendation } : {}) })
    .where(and(eq(hrmsInterviews.id, id), eq(hrmsInterviews.tenantId, tenantId)));
}

// --- Public careers (published vacancies) ---

export async function listPublishedOpenings(tenantId: string): Promise<JobOpeningRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsJobOpenings)
    .where(and(
      eq(hrmsJobOpenings.tenantId, tenantId),
      eq(hrmsJobOpenings.isPublished, "true"),
      eq(hrmsJobOpenings.status, "open"),
    ))
    .orderBy(desc(hrmsJobOpenings.createdAt))
    .limit(100));
}

export async function findPublishedOpening(id: string, tenantId: string): Promise<JobOpeningRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsJobOpenings)
    .where(and(
      eq(hrmsJobOpenings.id, id),
      eq(hrmsJobOpenings.tenantId, tenantId),
      eq(hrmsJobOpenings.isPublished, "true"),
      eq(hrmsJobOpenings.status, "open"),
    ))
    .limit(1));
  return rows[0] ?? null;
}

export async function findJobOpeningById(id: string): Promise<JobOpeningRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsJobOpenings)
    .where(eq(hrmsJobOpenings.id, id))
    .limit(1));
  return rows[0] ?? null;
}

export async function findJobOpeningByIdTx(tx: Writer, id: string, tenantId: string): Promise<JobOpeningRow | null> {
  const rows = await (tx as typeof db).select().from(hrmsJobOpenings)
    .where(and(eq(hrmsJobOpenings.id, id), eq(hrmsJobOpenings.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateJobOpening(tx: Writer, id: string, patch: Partial<typeof hrmsJobOpenings.$inferInsert>): Promise<void> {
  await tx.update(hrmsJobOpenings).set({ ...patch, updatedAt: new Date() }).where(eq(hrmsJobOpenings.id, id));
}

// --- Talent Pool (resume bank / candidate search) ---

export async function searchApplications(
  tenantId: string,
  filters: { skill?: string; minExp?: number; source?: string },
  limit = 100,
): Promise<ApplicationRow[]> {
  const conds = [eq(hrmsApplications.tenantId, tenantId)];
  if (filters.source) conds.push(eq(hrmsApplications.source, filters.source));
  // Skill filter uses array containment (requires GIN index).
  // For simplicity, we filter in JS after fetch (acceptable for <10k rows per tenant).
  let rows = await scopedRead((tx) => tx.select().from(hrmsApplications)
    .where(and(...conds))
    .orderBy(desc(hrmsApplications.appliedAt))
    .limit(limit * 2)); // over-fetch to compensate for JS filters

  if (filters.skill) {
    const s = filters.skill.toLowerCase();
    rows = rows.filter((r) => (r.skills as string[] | null)?.some((sk) => sk.toLowerCase().includes(s)));
  }
  if (filters.minExp !== undefined) {
    rows = rows.filter((r) => (r.experienceYears ?? 0) >= filters.minExp!);
  }
  return rows.slice(0, limit);
}

export async function countApplicationsBySource(tenantId: string): Promise<{ internal: number; public: number }> {
  const rows = await scopedRead((tx) => tx.select({ source: hrmsApplications.source, count: sql<number>`count(*)::int` })
    .from(hrmsApplications)
    .where(eq(hrmsApplications.tenantId, tenantId))
    .groupBy(hrmsApplications.source));
  let internal = 0, pub = 0;
  for (const r of rows) {
    if (r.source === "public_portal") pub = r.count;
    else internal += r.count;
  }
  return { internal, public: pub };
}
