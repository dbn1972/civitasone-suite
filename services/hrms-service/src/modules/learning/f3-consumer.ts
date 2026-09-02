import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import {
  computeProgress, deriveEnrollmentStatus, nextResumeLesson, checkPrerequisites,
} from "./domain.js";
import { lessons, modules, enrollments } from "./schema.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-learning" });

/**
 * F3 leftover fix (same bug class as leave/f3-consumer `leave_policy_admin_routes__0`):
 *
 *  - `learning_routes__4` referenced an undefined `mod` — routes.ts fetches the parent
 *    module (`repo.getModule`) so the lesson can be denormalised onto its course
 *    (`courseId: mod.courseId`), but the fetch was dropped. Every "add lesson" POST threw
 *    a ReferenceError in this consumer after the route had already answered 201.
 *  - `learning_routes__6` referenced undefined `enrollment` and `lesson` — routes.ts
 *    fetches the lesson, then the learner's enrollment for that lesson's course, before
 *    publishing. Both were dropped, so *every* lesson-progress POST crashed here after
 *    answering 200: progress, completion percentage, resume pointer and course-completion
 *    status were all silently never recorded.
 *
 * Zod `.default(...)` values from validators.ts are mirrored field-for-field below,
 * because `body` here is the raw pre-validation request body forwarded through the queue
 * (`creditHours`, `sequence`, `durationMins` and `category` are all NOT NULL columns that
 * would otherwise be written as undefined).
 *
 * The two lookups added here read inside `tx` rather than via the repo's scopedRead
 * helpers so they are read-your-own-writes consistent with the writes in the same
 * transaction (and match the existing `...Tx` helpers this file already uses).
 *
 * Fake-response-data fix (same bug class as gpf PR #882 / assessment-manpower-planning-
 * training-admin-recruitment PRs #890-892): `learning_routes__3` (create module),
 * `learning_routes__4` (create lesson) and `learning_routes__5` (create enrollment) used
 * to receive the PARENT's id as the publish `id` (courseId, moduleId, courseId
 * respectively) while independently minting their OWN `randomUUID()` for the real row
 * here — so routes.ts's placeholder-echoing response handed callers back the wrong id
 * entirely (a course id disguised as a module id, etc.), not just a placeholder status.
 * routes.ts now mints the real row id itself and publishes with THAT id, so:
 *   - `id` (this consumer's local var, from `p.id`) is now the REAL row id for __3/__4/__5
 *     — used directly instead of `randomUUID()`.
 *   - the PARENT id (previously read off `id`) is now read from `params.id` (the URL
 *     param routes.ts always forwards), since `id` no longer holds it.
 */
export function registerF3_learning_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "learning_routes__0",
      "learning_routes__1",
      "learning_routes__2",
      "learning_routes__3",
      "learning_routes__4",
      "learning_routes__5",
      "learning_routes__6",
      "learning_routes__7",
      "learning_routes__8",
      "learning_routes__9",
      "learning_routes__10",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "learning_routes__0": {
            await repo.insertCourse(tx, {
                  id, tenantId: p.tenantId, code: body.code, title: body.title,
                  description: body.description ?? null, category: body.category ?? "general",
                  creditHours: String(body.creditHours ?? 0), status: "draft", createdBy: msg.actorId,
                });
            break;
          }
          case "learning_routes__1": {
            await repo.publishCourse(tx, p.tenantId, id);
            break;
          }
          case "learning_routes__2": {
            await repo.insertPrerequisite(tx, {
                  tenantId: p.tenantId, courseId: id, prerequisiteCourseId: body.prerequisiteCourseId,
                });
            break;
          }
          case "learning_routes__3": {
            // `id` is now the module's own real id (routes.ts mints it before
            // publishing); the parent course id comes from the URL param.
            const courseId = (params.id as string) || "";
            await repo.insertModule(tx, {
                  id, tenantId: p.tenantId, courseId, title: body.title,
                  sequence: body.sequence ?? 1,
                });
            break;
          }
          case "learning_routes__4": {
            // `id` is now the lesson's own real id; the parent module id comes
            // from the URL param (routes.ts: const mod = await repo.getModule(ctx.tenantId, id)
            // where that `id` was the URL param, matching `moduleId` here).
            const moduleId = (params.id as string) || "";
            const modRows = await tx.select().from(modules)
              .where(and(eq(modules.tenantId, p.tenantId), eq(modules.id, moduleId)))
              .limit(1);
            const mod = modRows[0];
            if (!mod) {
              log.warn({ op, moduleId, messageId: msg.messageId }, "module disappeared before async lesson insert");
              return;
            }
            await repo.insertLesson(tx, {
                  id, tenantId: p.tenantId, moduleId, courseId: mod.courseId,
                  title: body.title, sequence: body.sequence ?? 1, contentType: body.contentType,
                  contentUri: body.contentUri ?? null, durationMins: body.durationMins ?? 0,
                });
            break;
          }
          case "learning_routes__5": {
            // `id` is now the enrollment's own real id; the parent course id
            // comes from the URL param.
            const courseId = (params.id as string) || "";
            await repo.insertEnrollment(tx, {
                  id, tenantId: p.tenantId, courseId, employeeId: body.employeeId, status: "enrolled", progressPct: 0,
                });
            break;
          }
          case "learning_routes__6": {
            // routes.ts: const lesson = await repo.getLesson(...); const enrollment = await repo.getEnrollment(tenantId, lesson.courseId, body.employeeId);
            const lessonRows = await tx.select().from(lessons)
              .where(and(eq(lessons.tenantId, p.tenantId), eq(lessons.id, id)))
              .limit(1);
            const lesson = lessonRows[0];
            if (!lesson) {
              log.warn({ op, lessonId: id, messageId: msg.messageId }, "lesson disappeared before async progress write");
              return;
            }
            const enrollmentRows = await tx.select().from(enrollments)
              .where(and(
                eq(enrollments.tenantId, p.tenantId),
                eq(enrollments.courseId, lesson.courseId),
                eq(enrollments.employeeId, body.employeeId),
              ))
              .limit(1);
            const enrollment = enrollmentRows[0];
            if (!enrollment) {
              log.warn({ op, lessonId: id, employeeId: body.employeeId, messageId: msg.messageId }, "enrollment disappeared before async progress write");
              return;
            }
            await repo.upsertLessonProgress(tx, {
                    tenantId: p.tenantId, enrollmentId: enrollment.id, lessonId: id,
                    status: body.status ?? "completed",
                    completedAt: (body.status ?? "completed") === "completed" ? new Date() : null,
                  });
                  const allLessons = await repo.listLessonsByCourseTx(tx, p.tenantId, lesson.courseId);
                  const done = await repo.completedLessonIdsTx(tx, p.tenantId, enrollment.id);
                  const doneSet = new Set(done);
                  const progressPct = computeProgress(allLessons.length, doneSet.size);
                  const status = deriveEnrollmentStatus(progressPct);
                  const resumeLessonId = nextResumeLesson(allLessons.map((l) => l.id), doneSet);
                  const completedAt = status === "completed" ? new Date() : null;
                  await repo.updateEnrollmentProgress(tx, p.tenantId, enrollment.id, { progressPct, status, resumeLessonId, completedAt });
            break;
          }
          case "learning_routes__7": {
            // F3 leftover fix (batch 2, resweep): course metadata PATCH. The
            // route already 404s synchronously if the course is missing (see
            // routes.ts), so this is just the guarded field-by-field update
            // that used to run inline.
            const updateData: { title?: string; description?: string | null; category?: string; creditHours?: string } = {};
            if (body.title !== undefined) updateData.title = body.title;
            if (body.description !== undefined) updateData.description = body.description;
            if (body.category !== undefined) updateData.category = body.category;
            if (body.creditHours !== undefined) updateData.creditHours = body.creditHours;
            await repo.updateCourse(tx, p.tenantId, id, updateData);
            break;
          }
          case "learning_routes__8": {
            // F3 leftover fix (batch 2, resweep): create a training plan.
            await repo.insertTrainingPlan(tx, {
                  id, tenantId: p.tenantId, title: body.title,
                  planYear: body.planYear,
                  departmentId: body.departmentId ?? null,
                  roleCode: body.roleCode ?? null,
                  status: "draft", createdBy: msg.actorId,
                });
            break;
          }
          case "learning_routes__9": {
            // F3 leftover fix (batch 2, resweep): add a training-plan item.
            // The route already 404s synchronously if the parent plan is
            // missing (see routes.ts).
            const planId = (params.id as string) || "";
            await repo.insertTrainingPlanItem(tx, {
                  id, tenantId: p.tenantId, planId,
                  courseId: body.courseId ?? null, trainingId: body.trainingId ?? null,
                  targetDate: body.targetDate ?? null, mandatory: body.mandatory ? 1 : 0,
                });
            break;
          }
          case "learning_routes__10": {
            // F3 leftover fix (batch 2, resweep): enrollment progress PATCH by
            // enrollment id (distinct from `learning_routes__6`, which updates
            // progress by LESSON id and recomputes the aggregate). Restored:
            // `existing` — routes.ts reads the enrollment first to preserve its
            // current `resumeLessonId` (this endpoint doesn't set one).
            const existing = await repo.getEnrollmentById(p.tenantId, id);
            if (!existing) {
              log.warn({ op, enrollmentId: id, messageId: msg.messageId }, "enrollment disappeared before async progress PATCH");
              return;
            }
            const pct = Number(body.percentComplete);
            const status = pct >= 100 ? "completed" : pct > 0 ? "in_progress" : "enrolled";
            const completedAt = pct >= 100 ? new Date() : null;
            await repo.updateEnrollmentProgress(tx, p.tenantId, id, {
                  progressPct: pct, status, resumeLessonId: existing.resumeLessonId ?? null, completedAt,
                });
            break;
          }
        }
      });
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
