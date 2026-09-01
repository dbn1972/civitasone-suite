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
 * Unlike the other modules in this batch, routes.ts here publishes the real `:id` path
 * param as the message id, so the generated `id` local is correct and is left as-is.
 *
 * Zod `.default(...)` values from validators.ts are mirrored field-for-field below,
 * because `body` here is the raw pre-validation request body forwarded through the queue
 * (`creditHours`, `sequence`, `durationMins` and `category` are all NOT NULL columns that
 * would otherwise be written as undefined).
 *
 * The two lookups added here read inside `tx` rather than via the repo's scopedRead
 * helpers so they are read-your-own-writes consistent with the writes in the same
 * transaction (and match the existing `...Tx` helpers this file already uses).
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
            await repo.insertModule(tx, {
                  id: randomUUID(), tenantId: p.tenantId, courseId: id, title: body.title,
                  sequence: body.sequence ?? 1,
                });
            break;
          }
          case "learning_routes__4": {
            // routes.ts: const mod = await repo.getModule(ctx.tenantId, id);
            const modRows = await tx.select().from(modules)
              .where(and(eq(modules.tenantId, p.tenantId), eq(modules.id, id)))
              .limit(1);
            const mod = modRows[0];
            if (!mod) {
              log.warn({ op, moduleId: id, messageId: msg.messageId }, "module disappeared before async lesson insert");
              return;
            }
            await repo.insertLesson(tx, {
                  id: randomUUID(), tenantId: p.tenantId, moduleId: id, courseId: mod.courseId,
                  title: body.title, sequence: body.sequence ?? 1, contentType: body.contentType,
                  contentUri: body.contentUri ?? null, durationMins: body.durationMins ?? 0,
                });
            break;
          }
          case "learning_routes__5": {
            await repo.insertEnrollment(tx, {
                  id: randomUUID(), tenantId: p.tenantId, courseId: id, employeeId: body.employeeId, status: "enrolled", progressPct: 0,
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
        }
      });
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
