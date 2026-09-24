import { eq, and, inArray, notInArray, sql, desc, ne, gt } from "drizzle-orm";
import { db, scopedRead} from "../../shared/db.js";
import { hrmsJobOpenings, hrmsApplications, hrmsOffers, hrmsInterviews, type ApplicationRow, type JobOpeningRow, type InterviewRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * Recruitment hardening: stages/statuses beyond which an application can no
 * longer be (re-)offered -- already offered, already hired, or in a terminal
 * status (withdrawn/rejected/joined). Exported so routes.ts's PATCH
 * .../offer handler can run the identical synchronous pre-check (fast 409)
 * that claimApplicationForOffer below enforces atomically.
 */
// Plain (not readonly) string[]: drizzle's notInArray()/inArray() overloads
// want a mutable (string | Placeholder)[] and reject a readonly array.
export const NOT_OFFERABLE_STAGES: string[] = ["offered", "hired"];
export const NOT_OFFERABLE_STATUSES: string[] = ["withdrawn", "rejected", "joined"];

export async function findApplicationById(id: string, tenantId: string): Promise<ApplicationRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsApplications)
    .where(and(eq(hrmsApplications.id, id), eq(hrmsApplications.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

/** Tx-scoped variant of findApplicationById -- see .claude/skills/16-production-readiness-audit.md section 1. */
export async function findApplicationByIdTx(tx: Writer, id: string, tenantId: string): Promise<ApplicationRow | null> {
  const rows = await (tx as typeof db).select().from(hrmsApplications)
    .where(and(eq(hrmsApplications.id, id), eq(hrmsApplications.tenantId, tenantId)))
    .limit(1);
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

/**
 * BUG-3 fix: atomically claim an application for hiring. Mirrors leave/
 * repo.ts's approveLeaveApp WHERE-status guard (H2): an UPDATE ... WHERE
 * stage != 'hired' that only succeeds (and returns true) when this
 * application hasn't already been hired. Returns false (0 rows affected)
 * when it's already in the "hired" stage, so the hire consumer can skip
 * creating a second employee record for a duplicate/redelivered
 * applicationHire command that reaches it under a different messageId than
 * the original attempt (see recruitment/commands.ts's hireApplication for
 * the deterministic-messageId half of this fix) instead of racing past a
 * blind updateApplication and creating two employees for one application.
 */
export async function claimApplicationForHire(tx: Writer, id: string, tenantId: string): Promise<boolean> {
  const result = await tx.update(hrmsApplications)
    // Recruitment hardening: this used to write status: "closed", which is
    // NOT a member of hrms_applications_status_check (active, shortlisted,
    // rejected, offered, joined, withdrawn -- see migration
    // 0035_check_constraints_status_columns.sql, VALIDATEd so it's enforced
    // on every write) -- confirmed live against the dev DB. Every real hire
    // through this path would have thrown a check-constraint violation.
    // "joined" is the enum's actual terminal "hired" value; nothing else in
    // the codebase reads hrms_applications.status === "closed" (verified).
    .set({ stage: "hired", status: "joined", updatedAt: new Date() })
    .where(and(
      eq(hrmsApplications.id, id),
      eq(hrmsApplications.tenantId, tenantId),
      ne(hrmsApplications.stage, "hired"),
    ))
    .returning({ id: hrmsApplications.id });
  return result.length > 0;
}

/**
 * Recruitment hardening (Bug 1): atomically claim an application for the
 * offer step. Mirrors claimApplicationForHire's WHERE-guard pattern (itself
 * mirroring leave/repo.ts's approveLeaveApp H2 guard): only succeeds when the
 * application is genuinely offer-eligible right now -- not already offered
 * or hired, and not withdrawn/rejected/joined (NOT_OFFERABLE_STAGES /
 * NOT_OFFERABLE_STATUSES above). routes.ts's PATCH .../offer handler runs
 * the same check synchronously first for fast HTTP feedback, but only this
 * atomic UPDATE closes the race between that read and this consumer actually
 * processing the command (e.g. two concurrent offer attempts, or a withdraw
 * landing in between).
 */
export async function claimApplicationForOffer(tx: Writer, id: string, tenantId: string): Promise<boolean> {
  const result = await tx.update(hrmsApplications)
    .set({ stage: "offered", updatedAt: new Date() })
    .where(and(
      eq(hrmsApplications.id, id),
      eq(hrmsApplications.tenantId, tenantId),
      notInArray(hrmsApplications.stage, NOT_OFFERABLE_STAGES),
      notInArray(hrmsApplications.status, NOT_OFFERABLE_STATUSES),
    ))
    .returning({ id: hrmsApplications.id });
  return result.length > 0;
}

/**
 * Recruitment hardening (Bug 3): atomically claim one vacancy on a job
 * opening as part of a hire. Mirrors leave/repo.ts's debitLeaveBalance -- a
 * single guarded UPDATE ... WHERE vacancies > 0, so two concurrent hire
 * attempts for the same job opening's LAST vacancy can never both succeed:
 * Postgres row-locks the first UPDATE until it commits or rolls back, and
 * the second then sees the already-decremented value, so its own
 * `vacancies > 0` guard fails (0 rows affected) rather than racing past it.
 * When this decrements vacancies to 0, the job opening's status flips to
 * "filled" in the SAME statement (see migration
 * 0035_check_constraints_status_columns.sql for the valid status enum:
 * open/closed/cancelled/filled).
 */
export async function claimVacancy(tx: Writer, jobOpeningId: string, tenantId: string): Promise<boolean> {
  const result = await tx.update(hrmsJobOpenings)
    .set({
      vacancies: sql`${hrmsJobOpenings.vacancies} - 1`,
      status: sql`CASE WHEN ${hrmsJobOpenings.vacancies} - 1 <= 0 THEN 'filled' ELSE ${hrmsJobOpenings.status} END`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(hrmsJobOpenings.id, jobOpeningId),
      eq(hrmsJobOpenings.tenantId, tenantId),
      gt(hrmsJobOpenings.vacancies, 0),
    ))
    .returning({ id: hrmsJobOpenings.id });
  return result.length > 0;
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
  const rows = await scopedRead((tx) => tx
    .select({
      jobOpeningId: hrmsApplications.jobOpeningId,
      count: sql<number>`count(*)::int`,
    })
    .from(hrmsApplications)
    .where(and(eq(hrmsApplications.tenantId, tenantId), inArray(hrmsApplications.jobOpeningId, jobIds)))
    .groupBy(hrmsApplications.jobOpeningId));
  for (const row of rows) counts.set(row.jobOpeningId, row.count);
  return counts;
}

// --- Interviews (P0-2: persisted in recruitment.hrms_interviews) ---


export async function findJobOpeningByTenant(id: string, tenantId: string): Promise<JobOpeningRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsJobOpenings)
    .where(and(eq(hrmsJobOpenings.id, id), eq(hrmsJobOpenings.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

export async function listApplicationsByJobOpening(tenantId: string, jobOpeningId: string, limit = 500): Promise<ApplicationRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsApplications)
    .where(and(eq(hrmsApplications.tenantId, tenantId), eq(hrmsApplications.jobOpeningId, jobOpeningId)))
    .orderBy(desc(hrmsApplications.appliedAt))
    .limit(limit));
}

export async function insertInterview(tx: Writer, row: typeof hrmsInterviews.$inferInsert): Promise<void> {
  await tx.insert(hrmsInterviews).values(row);
}

export async function findInterviewById(id: string, tenantId: string): Promise<InterviewRow | null> {
  return scopedRead((tx) => findInterviewByIdTx(tx, id, tenantId));
}

/** Tx-scoped variant of findInterviewById -- see .claude/skills/16-production-readiness-audit.md section 1. */
export async function findInterviewByIdTx(tx: Writer, id: string, tenantId: string): Promise<InterviewRow | null> {
  const rows = await (tx as typeof db).select().from(hrmsInterviews)
    .where(and(eq(hrmsInterviews.id, id), eq(hrmsInterviews.tenantId, tenantId)))
    .limit(1);
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
      eq(hrmsJobOpenings.isPublished, true),
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
      eq(hrmsJobOpenings.isPublished, true),
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
