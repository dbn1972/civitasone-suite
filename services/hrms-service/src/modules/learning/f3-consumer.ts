// @ts-nocheck — generated F3 leftover consumer; locals closed over from route txs
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
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-learning" });
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
                  description: body.description ?? null, category: body.category,
                  creditHours: String(body.creditHours), status: "draft", createdBy: msg.actorId,
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
                  id: randomUUID(), tenantId: p.tenantId, courseId: id, title: body.title, sequence: body.sequence,
                });
            break;
          }
          case "learning_routes__4": {
            await repo.insertLesson(tx, {
                  id: randomUUID(), tenantId: p.tenantId, moduleId: id, courseId: mod.courseId,
                  title: body.title, sequence: body.sequence, contentType: body.contentType,
                  contentUri: body.contentUri ?? null, durationMins: body.durationMins,
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
            await repo.upsertLessonProgress(tx, {
                    tenantId: p.tenantId, enrollmentId: enrollment.id, lessonId: id,
                    status: body.status, completedAt: body.status === "completed" ? new Date() : null,
                  });
                  const allLessons = await repo.listLessonsByCourseTx(tx, p.tenantId, lesson.courseId);
                  const done = await repo.completedLessonIdsTx(tx, p.tenantId, enrollment.id);
                  const doneSet = new Set(done);
                  const progressPct = computeProgress(allLessons.length, doneSet.size);
                  const status = deriveEnrollmentStatus(progressPct);
                  const resumeLessonId = nextResumeLesson(allLessons.map((l) => l.id), doneSet);
                  const completedAt = status === "completed" ? new Date() : null;
                  return repo.updateEnrollmentProgress(tx, p.tenantId, enrollment.id, { progressPct, status, resumeLessonId, completedAt });
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
