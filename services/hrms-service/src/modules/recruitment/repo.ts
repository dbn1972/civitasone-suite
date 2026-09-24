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


/**
 * Department scoping (HIGH finding): the set of a tenant's job-opening ids
 * belonging to one department, used to scope interview-routes.ts's list
 * endpoint for a manager/hiring_manager-role caller (see dept-scope.ts) to
 * only the interviews for job openings in their own department.
 */
export async function listJobOpeningIdsByDepartment(tenantId: string, departmentId: string): Promise<string[]> {
  const rows = await scopedRead((tx) => tx.select({ id: hrmsJobOpenings.id }).from(hrmsJobOpenings)
    .where(and(eq(hrmsJobOpenings.tenantId, tenantId), eq(hrmsJobOpenings.departmentId, departmentId))));
  return rows.map((r) => r.id);
}

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
  filters: { jobOpeningId?: string; applicationId?: string; jobOpeningIdIn?: string[] },
  limit = 50,
): Promise<InterviewRow[]> {
  const conds = [eq(hrmsInterviews.tenantId, tenantId)];
  if (filters.jobOpeningId) conds.push(eq(hrmsInterviews.jobOpeningId, filters.jobOpeningId));
  if (filters.applicationId) conds.push(eq(hrmsInterviews.applicationId, filters.applicationId));
  // Department scoping (HIGH finding): restrict to interviews whose job
  // opening belongs to one of the caller's department's job openings --
  // see dept-scope.ts. Only set for a department-scoped (non-tenant-wide)
  // caller; a privileged/tenant-wide caller never passes this.
  if (filters.jobOpeningIdIn) {
    if (filters.jobOpeningIdIn.length === 0) return [];
    conds.push(inArray(hrmsInterviews.jobOpeningId, filters.jobOpeningIdIn));
  }
  return scopedRead((tx) => tx.select().from(hrmsInterviews)
    .where(and(...conds))
    .orderBy(desc(hrmsInterviews.scheduledDate))
    .limit(limit));
}

/**
 * HIGH finding: POST /v1/hrms/interviews had no double-booking check at all
 * -- any number of interviews could be scheduled for the same interviewer(s)
 * at overlapping times. Returns interviews sharing at least one interviewer
 * with `interviewerIds` (excluding cancelled ones) whose
 * [scheduledAt, scheduledAt+duration) window genuinely overlaps the given
 * one -- a real half-open-interval comparison, not just an exact-match on
 * start time.
 *
 * The DB query narrows to interviews sharing at least one interviewer
 * (jsonb_array_elements_text over panel_members, which stores the
 * interviewer id array as jsonb -- see schema.ts) and to a +-1 day window
 * around the target date (cheap, index-friendly on scheduled_date; durationMinutes
 * has no enforced upper bound in the route's Zod schema, so a same-day-only
 * filter could in theory miss a pathologically long "interview" spanning
 * midnight). The exact overlap comparison then runs in JS on the narrowed
 * candidate set, reconstructing each side's start/end using the same UTC
 * date+time convention interview-routes.ts already derives scheduledAt from
 * (new Date(`${date}T${time}:00.000Z`)) -- doing the interval comparison
 * itself in raw SQL across a `date` + `varchar` time pair invites interval-
 * cast mistakes for little benefit at this table's scale.
 */
export async function findOverlappingInterviews(
  tenantId: string,
  interviewerIds: string[],
  scheduledDate: string,
  scheduledTime: string,
  durationMinutes: number,
): Promise<InterviewRow[]> {
  return scopedRead((tx) => findOverlappingInterviewsTx(tx, tenantId, interviewerIds, scheduledDate, scheduledTime, durationMinutes));
}

/** Tx-scoped variant of findOverlappingInterviews -- see .claude/skills/16-production-readiness-audit.md section 1.
 *  Used by f3-consumer.ts's recruitment_interview_routes__0 case as an atomic re-check: the route's own
 *  synchronous pre-check (interview-routes.ts) gives fast HTTP feedback for the common case, but that
 *  read-then-later-publish has its own race window (two near-simultaneous schedule requests) this alone
 *  can't close -- mirrors the claimApplicationForOffer / claimVacancy precedent documented above. */
export async function findOverlappingInterviewsTx(
  tx: Writer,
  tenantId: string,
  interviewerIds: string[],
  scheduledDate: string,
  scheduledTime: string,
  durationMinutes: number,
  excludeInterviewId?: string,
): Promise<InterviewRow[]> {
  if (interviewerIds.length === 0) return [];
  const newStart = new Date(`${scheduledDate}T${scheduledTime}:00.000Z`).getTime();
  const newEnd = newStart + durationMinutes * 60_000;

  const dayBefore = new Date(`${scheduledDate}T00:00:00.000Z`);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  const dayAfter = new Date(`${scheduledDate}T00:00:00.000Z`);
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  const windowStart = dayBefore.toISOString().slice(0, 10);
  const windowEnd = dayAfter.toISOString().slice(0, 10);

  const conds = [
    eq(hrmsInterviews.tenantId, tenantId),
    ne(hrmsInterviews.status, "cancelled"),
    sql`${hrmsInterviews.scheduledDate} BETWEEN ${windowStart}::date AND ${windowEnd}::date`,
  ];
  if (excludeInterviewId) conds.push(ne(hrmsInterviews.id, excludeInterviewId));

  // Interviewer overlap and the precise time-interval comparison both run in
  // JS on this date-window-narrowed candidate set. An earlier version tried
  // the interviewer match as a `jsonb_array_elements_text(...) = ANY(${arr})`
  // SQL condition -- drizzle-orm's `sql` template does not serialize a plain
  // JS array into a Postgres array literal for that context (confirmed live:
  // it throws `malformed array literal` because the bound parameter lands as
  // a single bare element, not "{...}"-wrapped), so this was a genuine bug,
  // not a style choice. Doing it in JS sidesteps that entirely.
  const candidates = await (tx as typeof db).select().from(hrmsInterviews).where(and(...conds));
  const interviewerSet = new Set(interviewerIds);

  return candidates.filter((iv) => {
    const panelIds = (iv.panelMembers as unknown[]).map((m) => String(m));
    if (!panelIds.some((pid) => interviewerSet.has(pid))) return false;
    const start = new Date(`${iv.scheduledDate as unknown as string}T${iv.scheduledTime}:00.000Z`).getTime();
    const end = start + iv.durationMinutes * 60_000;
    return newStart < end && start < newEnd;
  });
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

/**
 * MEDIUM finding: the talent pool showed every application ever submitted,
 * unfiltered by stage -- a candidate still mid-pipeline for one posting
 * showed up indistinguishably when staffing a different one. These are the
 * stages a candidate is genuinely OFF the active pipeline for and available
 * to be considered elsewhere -- mirrors the frontend's own existing
 * `activeStage` computation (talent-pool/page.tsx: everything NOT in this
 * set counts as "active"). "not_selected" has no current backend writer
 * (grep confirms only "applied"/"shortlisted"/"offered"/"hired"/"rejected"
 * are ever assigned to `stage` today) but is kept for parity with that same
 * frontend definition, which already anticipates it.
 */
export const AVAILABLE_STAGES: string[] = ["rejected", "withdrawn", "not_selected"];

export async function searchApplications(
  tenantId: string,
  filters: { skill?: string; minExp?: number; source?: string; stage?: string; includeActive?: boolean },
  limit = 100,
): Promise<ApplicationRow[]> {
  const conds = [eq(hrmsApplications.tenantId, tenantId)];
  if (filters.source) conds.push(eq(hrmsApplications.source, filters.source));
  // Explicit stage always wins. Otherwise, default to hiding active-pipeline
  // candidates (AVAILABLE_STAGES only) unless the caller explicitly opts
  // into the full unfiltered view via includeActive.
  if (filters.stage) {
    conds.push(eq(hrmsApplications.stage, filters.stage));
  } else if (!filters.includeActive) {
    conds.push(inArray(hrmsApplications.stage, AVAILABLE_STAGES));
  }
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
