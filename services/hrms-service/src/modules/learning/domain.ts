/**
 * SVC-122 — learning catalogue: pure, DB-free domain logic.
 * Deterministic and fully unit-testable; IO lives in the repo/route layer.
 */

/** Percentage of lessons completed (0..100, rounded). 0 lessons ⇒ 0%. */
export function computeProgress(totalLessons: number, completedLessons: number): number {
  if (totalLessons <= 0) return 0;
  const clamped = Math.max(0, Math.min(completedLessons, totalLessons));
  return Math.round((clamped / totalLessons) * 100);
}

export type EnrollmentStatus = "enrolled" | "in_progress" | "completed";

/** Derive enrolment status from progress percentage. */
export function deriveEnrollmentStatus(progressPct: number): EnrollmentStatus {
  if (progressPct >= 100) return "completed";
  if (progressPct <= 0) return "enrolled";
  return "in_progress";
}

/**
 * The resume point: the first lesson (in ordered sequence) that has NOT been
 * completed. Returns null when every lesson is complete.
 */
export function nextResumeLesson(
  orderedLessonIds: string[],
  completedLessonIds: Iterable<string>,
): string | null {
  const done = new Set(completedLessonIds);
  for (const id of orderedLessonIds) {
    if (!done.has(id)) return id;
  }
  return null;
}

export interface PrerequisiteCheck {
  met: boolean;
  missing: string[];
}

/**
 * Check whether all prerequisite courses have been completed by the employee.
 * `completedCourseIds` is the set of course ids the employee has completed.
 */
export function checkPrerequisites(
  requiredCourseIds: string[],
  completedCourseIds: Iterable<string>,
): PrerequisiteCheck {
  const done = new Set(completedCourseIds);
  const missing = requiredCourseIds.filter((id) => !done.has(id));
  return { met: missing.length === 0, missing };
}
