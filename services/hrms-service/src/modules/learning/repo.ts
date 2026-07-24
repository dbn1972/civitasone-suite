import { and, eq, ilike, or } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  courses, coursePrerequisites, modules, lessons, enrollments, lessonProgress,
  type CourseRow, type ModuleRow, type LessonRow, type EnrollmentRow,
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
