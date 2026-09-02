import { and, eq, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  courses, coursePrerequisites, modules, lessons, enrollments, lessonProgress,
  trainingPlans, trainingPlanItems,
  type CourseRow, type ModuleRow, type LessonRow, type EnrollmentRow,
  type TrainingPlanRow, type TrainingPlanItemRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ── courses ───────────────────────────────────────────────────────
export async function insertCourse(tx: Writer, row: typeof courses.$inferInsert): Promise<CourseRow> {
  const rows = await tx.insert(courses).values(row).returning();
  return rows[0]!;
}
export async function getCourse(tenantId: string, id: string): Promise<CourseRow | undefined> {
  const rows = await scopedRead((t) => t.select().from(courses)
    .where(and(eq(courses.id, id), eq(courses.tenantId, tenantId))).limit(1));
  return rows[0];
}
export async function listCourses(tenantId: string, search: string | undefined, limit = 100): Promise<CourseRow[]> {
  return scopedRead((t) => {
    const filters = [eq(courses.tenantId, tenantId)];
    if (search && search.length > 0) {
      const pat = `%${search}%`;
      filters.push(or(ilike(courses.title, pat), ilike(courses.code, pat), ilike(courses.category, pat))!);
    }
    return t.select().from(courses).where(and(...filters)).limit(limit);
  });
}
export async function publishCourse(tx: Writer, tenantId: string, id: string): Promise<CourseRow | null> {
  const rows = await tx.update(courses)
    .set({ status: "published", updatedAt: new Date() })
    .where(and(eq(courses.id, id), eq(courses.tenantId, tenantId), eq(courses.status, "draft")))
    .returning();
  return rows[0] ?? null;
}

// ── prerequisites ─────────────────────────────────────────────────
export async function insertPrerequisite(tx: Writer, row: typeof coursePrerequisites.$inferInsert): Promise<void> {
  await tx.insert(coursePrerequisites).values(row)
    .onConflictDoNothing({ target: [coursePrerequisites.tenantId, coursePrerequisites.courseId, coursePrerequisites.prerequisiteCourseId] });
}
export async function listPrerequisiteIds(tenantId: string, courseId: string): Promise<string[]> {
  const rows = await scopedRead((t) => t
    .select({ p: coursePrerequisites.prerequisiteCourseId })
    .from(coursePrerequisites)
    .where(and(eq(coursePrerequisites.tenantId, tenantId), eq(coursePrerequisites.courseId, courseId))));
  return rows.map((r) => r.p);
}

// ── modules & lessons ─────────────────────────────────────────────
export async function insertModule(tx: Writer, row: typeof modules.$inferInsert): Promise<ModuleRow> {
  const rows = await tx.insert(modules).values(row).returning();
  return rows[0]!;
}
export async function listModules(tenantId: string, courseId: string): Promise<ModuleRow[]> {
  return scopedRead((t) => t.select().from(modules)
    .where(and(eq(modules.tenantId, tenantId), eq(modules.courseId, courseId)))
    .orderBy(modules.sequence));
}
export async function insertLesson(tx: Writer, row: typeof lessons.$inferInsert): Promise<LessonRow> {
  const rows = await tx.insert(lessons).values(row).returning();
  return rows[0]!;
}
export async function listLessonsByCourse(tenantId: string, courseId: string): Promise<LessonRow[]> {
  return scopedRead((t) => t.select().from(lessons)
    .where(and(eq(lessons.tenantId, tenantId), eq(lessons.courseId, courseId)))
    .orderBy(lessons.sequence));
}
export async function getModule(tenantId: string, id: string): Promise<ModuleRow | undefined> {
  const rows = await scopedRead((t) => t.select().from(modules)
    .where(and(eq(modules.id, id), eq(modules.tenantId, tenantId))).limit(1));
  return rows[0];
}
export async function getLesson(tenantId: string, id: string): Promise<LessonRow | undefined> {
  const rows = await scopedRead((t) => t.select().from(lessons)
    .where(and(eq(lessons.id, id), eq(lessons.tenantId, tenantId))).limit(1));
  return rows[0];
}

// ── enrolments & progress ─────────────────────────────────────────
export async function getEnrollment(tenantId: string, courseId: string, employeeId: string): Promise<EnrollmentRow | undefined> {
  const rows = await scopedRead((t) => t.select().from(enrollments)
    .where(and(eq(enrollments.tenantId, tenantId), eq(enrollments.courseId, courseId), eq(enrollments.employeeId, employeeId))).limit(1));
  return rows[0];
}
export async function getEnrollmentById(tenantId: string, id: string): Promise<EnrollmentRow | undefined> {
  const rows = await scopedRead((t) => t.select().from(enrollments)
    .where(and(eq(enrollments.id, id), eq(enrollments.tenantId, tenantId))).limit(1));
  return rows[0];
}
export async function insertEnrollment(tx: Writer, row: typeof enrollments.$inferInsert): Promise<EnrollmentRow | null> {
  const rows = await tx.insert(enrollments).values(row)
    .onConflictDoNothing({ target: [enrollments.tenantId, enrollments.courseId, enrollments.employeeId] })
    .returning();
  return rows[0] ?? null;
}
/** Course ids the employee has completed (for prerequisite checks). */
export async function completedCourseIds(tenantId: string, employeeId: string): Promise<string[]> {
  const rows = await scopedRead((t) => t
    .select({ c: enrollments.courseId })
    .from(enrollments)
    .where(and(eq(enrollments.tenantId, tenantId), eq(enrollments.employeeId, employeeId), eq(enrollments.status, "completed"))));
  return rows.map((r) => r.c);
}
export async function upsertLessonProgress(tx: Writer, row: typeof lessonProgress.$inferInsert): Promise<void> {
  await tx.insert(lessonProgress).values(row)
    .onConflictDoUpdate({
      target: [lessonProgress.tenantId, lessonProgress.enrollmentId, lessonProgress.lessonId],
      set: { status: row.status ?? "completed", completedAt: row.completedAt ?? null },
    });
}
/**
 * Non-tx (scopedRead) read of currently-completed lesson ids for an enrolment.
 * Used by routes.ts to synchronously compute the post-write progress/status/
 * resume-point BEFORE the async write is queued, so the response can echo
 * real values instead of publishF3Write's placeholder. Mirrors
 * completedLessonIdsTx below, minus the tx-visibility requirement — the route
 * reads the state as it stands before this write, then toggles the one lesson
 * this request affects (see learning/routes.ts, learning_routes__6).
 */
export async function completedLessonIds(tenantId: string, enrollmentId: string): Promise<string[]> {
  const rows = await scopedRead((t) => t
    .select({ l: lessonProgress.lessonId })
    .from(lessonProgress)
    .where(and(eq(lessonProgress.tenantId, tenantId), eq(lessonProgress.enrollmentId, enrollmentId), eq(lessonProgress.status, "completed"))));
  return rows.map((r) => r.l);
}
// Tx-scoped reads — used inside the progress transaction so they SEE the
// lesson-progress row just upserted in the same transaction (scopedRead opens a
// separate transaction and would miss the uncommitted write).
export async function completedLessonIdsTx(tx: Writer, tenantId: string, enrollmentId: string): Promise<string[]> {
  const rows = await tx
    .select({ l: lessonProgress.lessonId })
    .from(lessonProgress)
    .where(and(eq(lessonProgress.tenantId, tenantId), eq(lessonProgress.enrollmentId, enrollmentId), eq(lessonProgress.status, "completed")));
  return rows.map((r) => r.l);
}
export async function listLessonsByCourseTx(tx: Writer, tenantId: string, courseId: string): Promise<LessonRow[]> {
  return tx.select().from(lessons)
    .where(and(eq(lessons.tenantId, tenantId), eq(lessons.courseId, courseId)))
    .orderBy(lessons.sequence);
}
export async function updateEnrollmentProgress(
  tx: Writer, tenantId: string, id: string,
  data: { progressPct: number; status: string; resumeLessonId: string | null; completedAt: Date | null },
): Promise<EnrollmentRow | null> {
  const rows = await tx.update(enrollments)
    .set({
      progressPct: data.progressPct, status: data.status,
      resumeLessonId: data.resumeLessonId, completedAt: data.completedAt, updatedAt: new Date(),
    })
    .where(and(eq(enrollments.id, id), eq(enrollments.tenantId, tenantId)))
    .returning();
  return rows[0] ?? null;
}
export async function listMyEnrollments(tenantId: string, employeeId: string): Promise<Array<EnrollmentRow & { courseTitle: string; courseCode: string }>> {
  return scopedRead((t) => t
    .select({
      id: enrollments.id, tenantId: enrollments.tenantId, courseId: enrollments.courseId,
      employeeId: enrollments.employeeId, status: enrollments.status, progressPct: enrollments.progressPct,
      resumeLessonId: enrollments.resumeLessonId, enrolledAt: enrollments.enrolledAt,
      updatedAt: enrollments.updatedAt, completedAt: enrollments.completedAt,
      courseTitle: courses.title, courseCode: courses.code,
    })
    .from(enrollments)
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .where(and(eq(enrollments.tenantId, tenantId), eq(enrollments.employeeId, employeeId)))) as never;
}

// ── dashboard stats ───────────────────────────────────────────────
/** Counts of enrollments grouped by status, optionally scoped to an employee. */
export async function countEnrollmentsByStatus(
  tenantId: string,
  employeeId?: string,
): Promise<{ status: string; count: number }[]> {
  const filters = [eq(enrollments.tenantId, tenantId)];
  if (employeeId) filters.push(eq(enrollments.employeeId, employeeId));
  const rows = await scopedRead((t) =>
    t.select({
      status: enrollments.status,
      count: sql<number>`count(*)::int`,
    })
    .from(enrollments)
    .where(and(...filters))
    .groupBy(enrollments.status),
  );
  return rows;
}

/** Overdue: enrolled or in_progress with no updatedAt in last 30 days (proxy). */
export async function countOverdueEnrollments(
  tenantId: string,
  employeeId?: string,
): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const filters = [
    eq(enrollments.tenantId, tenantId),
    inArray(enrollments.status, ["enrolled", "in_progress"]),
    lte(enrollments.updatedAt, cutoff),
  ];
  if (employeeId) filters.push(eq(enrollments.employeeId, employeeId));
  const rows = await scopedRead((t) =>
    t.select({ count: sql<number>`count(*)::int` })
    .from(enrollments)
    .where(and(...filters)),
  );
  return rows[0]?.count ?? 0;
}

// ── course update ─────────────────────────────────────────────────
export async function updateCourse(
  tx: Writer, tenantId: string, id: string,
  data: { title?: string; description?: string | null; category?: string; creditHours?: string },
): Promise<CourseRow | null> {
  const set: Partial<typeof courses.$inferInsert> = { updatedAt: new Date() };
  if (data.title !== undefined) set.title = data.title;
  if (data.description !== undefined) set.description = data.description;
  if (data.category !== undefined) set.category = data.category;
  if (data.creditHours !== undefined) set.creditHours = data.creditHours;
  const rows = await tx.update(courses)
    .set(set)
    .where(and(eq(courses.id, id), eq(courses.tenantId, tenantId)))
    .returning();
  return rows[0] ?? null;
}

// ── enrollment listing for a course (completion report) ───────────
export async function listEnrollmentsByCourse(
  tenantId: string,
  courseId: string,
  limit = 500,
): Promise<(EnrollmentRow & { employeeId: string })[]> {
  return scopedRead((t) =>
    t.select().from(enrollments)
    .where(and(eq(enrollments.tenantId, tenantId), eq(enrollments.courseId, courseId)))
    .orderBy(enrollments.enrolledAt)
    .limit(limit),
  ) as never;
}

// ── training plans ────────────────────────────────────────────────


export async function insertTrainingPlan(
  tx: Writer,
  row: typeof trainingPlans.$inferInsert,
): Promise<TrainingPlanRow> {
  const rows = await tx.insert(trainingPlans).values(row).returning();
  return rows[0]!;
}

export async function listTrainingPlans(tenantId: string, limit = 100): Promise<TrainingPlanRow[]> {
  return scopedRead((t) =>
    t.select().from(trainingPlans)
    .where(eq(trainingPlans.tenantId, tenantId))
    .orderBy(trainingPlans.planYear)
    .limit(limit),
  );
}

export async function getTrainingPlan(tenantId: string, id: string): Promise<TrainingPlanRow | undefined> {
  const rows = await scopedRead((t) =>
    t.select().from(trainingPlans)
    .where(and(eq(trainingPlans.id, id), eq(trainingPlans.tenantId, tenantId)))
    .limit(1),
  );
  return rows[0];
}

export async function listTrainingPlanItems(tenantId: string, planId: string): Promise<TrainingPlanItemRow[]> {
  return scopedRead((t) =>
    t.select().from(trainingPlanItems)
    .where(and(eq(trainingPlanItems.tenantId, tenantId), eq(trainingPlanItems.planId, planId))),
  );
}

export async function insertTrainingPlanItem(
  tx: Writer,
  row: typeof trainingPlanItems.$inferInsert,
): Promise<TrainingPlanItemRow> {
  const rows = await tx.insert(trainingPlanItems).values(row).returning();
  return rows[0]!;
}
