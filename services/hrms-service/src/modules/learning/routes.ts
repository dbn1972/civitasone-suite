import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  resolveOwnEmployeeIdIfBareEmployee,
  resolveOwnEmployeeIdIfNonHr,
} from "../../shared/self-scope.js";
import { resolveEmployeeForActor } from "../employee/actor-link.js";
import {
  computeProgress, deriveEnrollmentStatus, nextResumeLesson, checkPrerequisites,
} from "./domain.js";
import {
  createCourseBody, createModuleBody, createLessonBody,
  addPrerequisiteBody, enrollBody, lessonProgressBody,
} from "./validators.js";
import * as repo from "./repo.js";

const HR_ROLES  = ["hr_admin", "hr_officer", "super_admin"];
const ALL_ROLES = [...HR_ROLES, "manager", "employee"];
const idParam = z.object({ id: z.string().uuid() });

export async function learningRoutes(app: FastifyInstance): Promise<void> {
  // ── Catalogue: courses ──────────────────────────────────────────
  app.post("/v1/hrms/learning/courses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createCourseBody.parse(req.body);
    const id = randomUUID();
    await publishF3Write(ctx, "learning_routes__0", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    // `code` and `status` are echoed from the validated request / a deterministic
    // insert status, NOT from publishF3Write's placeholder (which only carries
    // {id, status: "accepted", correlationId} — matches the consumer's literal
    // `status: "draft"` on insert).
    return reply.code(201).send({ id, code: body.code, status: "draft" }) as any;
  });

  app.get("/v1/hrms/learning/courses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { q, status } = z.object({
      q: z.string().max(128).optional(),
      status: z.enum(["draft", "published", "retired"]).optional(),
    }).parse(req.query);
    // GAP-LEARNING-COURSES-01: non-HR roles only ever see published courses,
    // regardless of any ?status they pass. HR may filter by status (or omit
    // for all).
    const isHr = HR_ROLES.some((r) => ctx.roles.includes(r));
    const effectiveStatus = isHr ? status : "published";
    return reply.send(await repo.listCourses(ctx.tenantId, q, 100, effectiveStatus));
  });

  app.get("/v1/hrms/learning/courses/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const course = await repo.getCourse(ctx.tenantId, id);
    if (!course) throw new HttpError(404, "NOT_FOUND", "course not found");
    // GAP-LEARNING-COURSES-01: a non-published course is invisible (404) to
    // non-HR roles — drafts/retired must not be reachable by employees.
    const isHr = HR_ROLES.some((r) => ctx.roles.includes(r));
    if (!isHr && course.status !== "published") throw new HttpError(404, "NOT_FOUND", "course not found");
    const [mods, lessonRows, prereqIds] = await Promise.all([
      repo.listModules(ctx.tenantId, id),
      repo.listLessonsByCourse(ctx.tenantId, id),
      repo.listPrerequisiteIds(ctx.tenantId, id),
    ]);
    return reply.send({ ...course, modules: mods, lessons: lessonRows, prerequisites: prereqIds });
  });

  app.post("/v1/hrms/learning/courses/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const course = await repo.getCourse(ctx.tenantId, id);
    if (!course) throw new HttpError(404, "NOT_FOUND", "course not found");
    // Synchronous precheck: repo.publishCourse's `WHERE status = 'draft'` guard
    // only runs async in the F3 consumer, too late to answer this request. The
    // old `if (!row)` check below it was dead code — publishF3Write's placeholder
    // is never falsy — so publishing an already-published course silently
    // "succeeded" with a fake response instead of 409ing.
    if (course.status !== "draft") throw new HttpError(409, "INVALID_STATE", "only a draft course can be published");
    await publishF3Write(ctx, "learning_routes__1", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    // Deterministic post-publish status — matches repo.publishCourse's `status: "published"`.
    return reply.send({ id, status: "published" });
  });

  app.post("/v1/hrms/learning/courses/:id/prerequisites", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = addPrerequisiteBody.parse(req.body);
    const course = await repo.getCourse(ctx.tenantId, id);
    if (!course) throw new HttpError(404, "NOT_FOUND", "course not found");
    if (body.prerequisiteCourseId === id) throw new HttpError(409, "INVALID_PREREQ", "a course cannot be its own prerequisite");
    const prereq = await repo.getCourse(ctx.tenantId, body.prerequisiteCourseId);
    if (!prereq) throw new HttpError(404, "NOT_FOUND", "prerequisite course not found");
    await publishF3Write(ctx, "learning_routes__2", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ courseId: id, prerequisiteCourseId: body.prerequisiteCourseId }) as any;
  });

  // ── Structure: modules → lessons ────────────────────────────────
  app.post("/v1/hrms/learning/courses/:id/modules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = createModuleBody.parse(req.body);
    const course = await repo.getCourse(ctx.tenantId, id);
    if (!course) throw new HttpError(404, "NOT_FOUND", "course not found");
    // The module's real primary key is generated HERE (not inside the F3
    // consumer) and threaded through as the publish id, so the response can
    // answer with the actual row id. Previously this called publishF3Write
    // with the COURSE id as the third argument, so the placeholder's `row.id`
    // echoed back the course id disguised as the new module's id — while the
    // consumer independently minted its own `randomUUID()` for the real row.
    // Every caller that captured this response's `id` and used it as a module
    // id (e.g. to add lessons under it) got a 404 chasing a course id.
    const moduleId = randomUUID();
    await publishF3Write(ctx, "learning_routes__3", moduleId, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: moduleId, courseId: id, sequence: body.sequence ?? 1 }) as any;
  });

  app.post("/v1/hrms/learning/modules/:id/lessons", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = createLessonBody.parse(req.body);
    const mod = await repo.getModule(ctx.tenantId, id);
    if (!mod) throw new HttpError(404, "NOT_FOUND", "module not found");
    // Same fix as the module-creation route above: mint the lesson's real id
    // synchronously and publish with it, instead of echoing back the module id.
    const lessonId = randomUUID();
    await publishF3Write(ctx, "learning_routes__4", lessonId, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: lessonId, moduleId: id, contentType: body.contentType }) as any;
  });

  // ── Enrolment + progress tracking ───────────────────────────────
  app.post("/v1/hrms/learning/courses/:id/enroll", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = enrollBody.parse(req.body);
    // IDOR fix (GAP-LEARNING-COURSES-DETAIL-02): a non-HR caller may only
    // enrol THEMSELVES, regardless of the employeeId they submit. HR passes
    // through (enrol-on-behalf is intended). A non-HR caller with no linked
    // employee record is rejected (fail closed) rather than silently enrolling
    // the attacker-chosen id.
    const effectiveEmployeeId = await resolveOwnEmployeeIdIfNonHr(ctx, req, body.employeeId);
    if (!effectiveEmployeeId) throw new HttpError(403, "NO_EMPLOYEE_LINK", "no employee record linked to this account");
    const course = await repo.getCourse(ctx.tenantId, id);
    if (!course) throw new HttpError(404, "NOT_FOUND", "course not found");
    if (course.status !== "published") throw new HttpError(409, "NOT_PUBLISHED", "course is not published");

    // Prerequisite gate.
    const [prereqIds, doneCourses] = await Promise.all([
      repo.listPrerequisiteIds(ctx.tenantId, id),
      repo.completedCourseIds(ctx.tenantId, effectiveEmployeeId),
    ]);
    const check = checkPrerequisites(prereqIds, doneCourses);
    if (!check.met) {
      return reply.code(409).send({ code: "PREREQUISITES_NOT_MET", message: "prerequisite courses not completed", missing: check.missing });
    }
    const existing = await repo.getEnrollment(ctx.tenantId, id, effectiveEmployeeId);
    if (existing) return reply.code(200).send({ id: existing.id, status: existing.status, progressPct: existing.progressPct });
    // Same id-generation fix as modules/lessons: mint the enrollment's real id
    // here and thread it through, instead of echoing back the course id. The
    // old post-publish `if (!row)` "lost the race" fallback below was dead
    // code (publishF3Write's placeholder is never falsy) trying to detect an
    // insertEnrollment onConflictDoNothing race — that race isn't observable
    // synchronously without doing the insert inline, so it's dropped rather
    // than faked; the synchronous `existing` check above already covers the
    // normal (non-racing) idempotent-reenrollment path this suite exercises.
    const enrollmentId = randomUUID();
    // Persist the SELF-SCOPED employee id (effectiveEmployeeId), not the raw
    // attacker-supplied body.employeeId, so the async consumer inserts the
    // enrolment against the correct identity.
    await publishF3Write(ctx, "learning_routes__5", enrollmentId, { body: { ...((req.body as Record<string, unknown>) ?? {}), employeeId: effectiveEmployeeId }, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    // Deterministic post-insert values — match the consumer's insertEnrollment literals.
    return reply.code(201).send({ id: enrollmentId, status: "enrolled", progressPct: 0 });
  });

  app.post("/v1/hrms/learning/lessons/:id/progress", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = lessonProgressBody.parse(req.body);
    // IDOR fix (GAP-LEARNING-COURSES-DETAIL-02): a non-HR caller may only
    // record progress for THEMSELVES. HR passes through. Fail closed when a
    // non-HR caller has no linked employee record.
    const effectiveEmployeeId = await resolveOwnEmployeeIdIfNonHr(ctx, req, body.employeeId);
    if (!effectiveEmployeeId) throw new HttpError(403, "NO_EMPLOYEE_LINK", "no employee record linked to this account");
    const lesson = await repo.getLesson(ctx.tenantId, id);
    if (!lesson) throw new HttpError(404, "NOT_FOUND", "lesson not found");
    const enrollment = await repo.getEnrollment(ctx.tenantId, lesson.courseId, effectiveEmployeeId);
    if (!enrollment) throw new HttpError(409, "NOT_ENROLLED", "employee is not enrolled in this course");

    // Compute the post-write progress/status/resume-point synchronously, via
    // the SAME pure domain functions the F3 consumer uses inside its
    // transaction (computeProgress / deriveEnrollmentStatus / nextResumeLesson
    // — previously imported here but unused). `currentlyCompleted` is read
    // BEFORE the write is queued, then toggled to reflect what this write will
    // make true, so the answer matches what the consumer will independently
    // persist (barring a concurrent write to the same enrollment, which is not
    // observable synchronously).
    const [allLessons, currentlyCompleted] = await Promise.all([
      repo.listLessonsByCourse(ctx.tenantId, lesson.courseId),
      repo.completedLessonIds(ctx.tenantId, enrollment.id),
    ]);
    const doneSet = new Set(currentlyCompleted);
    if (body.status === "completed") doneSet.add(id); else doneSet.delete(id);
    const progressPct = computeProgress(allLessons.length, doneSet.size);
    const status = deriveEnrollmentStatus(progressPct);
    const resumeLessonId = nextResumeLesson(allLessons.map((l) => l.id), doneSet);

    await publishF3Write(ctx, "learning_routes__6", id, { body: { ...((req.body as Record<string, unknown>) ?? {}), employeeId: effectiveEmployeeId }, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ enrollmentId: enrollment.id, progressPct, status, resumeLessonId });
  });

  app.get("/v1/hrms/learning/my-learning", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    // GAP-LEARNING-MY-LEARNING-01 IDOR fix: a bare employee always reads their
    // OWN enrolments regardless of the employeeId they submit; HR/manager pass
    // through. `employeeId` is now optional — when absent the caller gets their
    // own record (the normal self-service path).
    const { employeeId } = z.object({ employeeId: z.string().uuid().optional() }).parse(req.query);
    const effectiveEmployeeId = await resolveOwnEmployeeIdIfBareEmployee(ctx, req, employeeId ?? "");
    if (!effectiveEmployeeId) return reply.send([]);
    return reply.send(await repo.listMyEnrollments(ctx.tenantId, effectiveEmployeeId));
  });


  // ── LMS Dashboard stats ─────────────────────────────────────────
  // Returns enrolled/in_progress/completed/overdue counts, optionally scoped
  // to a single employee (add ?employeeId=<uuid>).
  app.get("/v1/hrms/learning/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { employeeId } = z.object({ employeeId: z.string().uuid().optional() }).parse(req.query);
    // GAP-LEARNING-MY-LEARNING-01: a bare employee only sees their OWN counts
    // regardless of ?employeeId; HR/manager may omit it for tenant-wide totals
    // or pass a specific id. A bare employee with no linked record gets zeros
    // (fail closed), never tenant-wide figures.
    const isPrivileged = ["hr_admin", "hr_officer", "super_admin", "manager"].some((r) => ctx.roles.includes(r));
    let scopedEmployeeId = employeeId;
    if (!isPrivileged) {
      const own = await resolveOwnEmployeeIdIfBareEmployee(ctx, req, employeeId ?? "");
      if (!own) return reply.send({ enrolled: 0, in_progress: 0, completed: 0, overdue: 0, total: 0 });
      scopedEmployeeId = own;
    }
    const [statusCounts, overdueCount] = await Promise.all([
      repo.countEnrollmentsByStatus(ctx.tenantId, scopedEmployeeId),
      repo.countOverdueEnrollments(ctx.tenantId, scopedEmployeeId),
    ]);
    const byStatus = Object.fromEntries(statusCounts.map((r) => [r.status, r.count]));
    return reply.send({
      enrolled:    byStatus["enrolled"]    ?? 0,
      in_progress: byStatus["in_progress"] ?? 0,
      completed:   byStatus["completed"]   ?? 0,
      overdue:     overdueCount,
      total:       statusCounts.reduce((s, r) => s + r.count, 0),
    });
  });

  // ── Update course metadata ──────────────────────────────────────
  app.patch("/v1/hrms/learning/courses/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      title:       z.string().min(1).max(256).optional(),
      description: z.string().max(2048).nullable().optional(),
      category:    z.string().max(64).optional(),
      creditHours: z.string().max(10).optional(),
    }).parse(req.body);
    const course = await repo.getCourse(ctx.tenantId, id);
    if (!course) throw new HttpError(404, "NOT_FOUND", "course not found");
    await publishF3Write(ctx, "learning_routes__7", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    // This is a metadata-only patch (title/description/category/creditHours) —
    // it never changes `status`, so the pre-write course's status is still
    // accurate to echo synchronously.
    return reply.code(202).send({ id, title: body.title ?? course.title, status: course.status }) as any;
  });

  // ── Course completion report (HR admin) ─────────────────────────
  app.get("/v1/hrms/learning/courses/:id/enrollments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const course = await repo.getCourse(ctx.tenantId, id);
    if (!course) throw new HttpError(404, "NOT_FOUND", "course not found");
    const rows = await repo.listEnrollmentsByCourse(ctx.tenantId, id);
    return reply.send({
      courseId: id,
      courseTitle: course.title,
      total: rows.length,
      data: rows.map((r) => ({
        id: r.id, employeeId: r.employeeId, status: r.status,
        progressPct: r.progressPct, enrolledAt: r.enrolledAt, completedAt: r.completedAt ?? null,
      })),
    });
  });

  // ── Training Plans ──────────────────────────────────────────────
  app.get("/v1/hrms/learning/training-plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { year, limit, offset } = z.object({
      year:   z.coerce.number().int().min(2020).max(2100).optional(),
      limit:  z.coerce.number().int().min(1).max(200).optional(),
      offset: z.coerce.number().int().min(0).optional(),
    }).parse(req.query);
    return reply.send(await repo.listTrainingPlans(ctx.tenantId, { year, limit, offset }));
  });

  app.post("/v1/hrms/learning/training-plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = z.object({
      title:        z.string().min(1).max(256),
      planYear:     z.number().int().min(2020).max(2100),
      departmentId: z.string().uuid().optional(),
      roleCode:     z.string().max(64).optional(),
    }).parse(req.body);
    const id = randomUUID();
    await publishF3Write(ctx, "learning_routes__8", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "draft" }) as any;
  });

  app.get("/v1/hrms/learning/training-plans/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const plan = await repo.getTrainingPlan(ctx.tenantId, id);
    if (!plan) throw new HttpError(404, "NOT_FOUND", "training plan not found");
    const items = await repo.listTrainingPlanItems(ctx.tenantId, id);
    return reply.send({ ...plan, items });
  });

  app.post("/v1/hrms/learning/training-plans/:id/items", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      courseId:   z.string().uuid().optional(),
      trainingId: z.string().uuid().optional(),
      targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      mandatory:  z.boolean().default(false),
    }).parse(req.body);
    const plan = await repo.getTrainingPlan(ctx.tenantId, id);
    if (!plan) throw new HttpError(404, "NOT_FOUND", "training plan not found");
    const itemId = randomUUID();
    await publishF3Write(ctx, "learning_routes__9", itemId, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id: itemId, planId: id }) as any;
  });

  // ── Enrollment direct access (HR admin + employee) ─────────────
  app.get("/v1/hrms/learning/enrollments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.getEnrollmentById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "enrollment not found");
    // GAP2-LEARNING-ENROLLMENTS-IDOR-01: a bare employee may only read their
    // OWN enrolment record. HR/manager pass through (same privilege boundary
    // as the dashboard handler). A non-privileged caller requesting a
    // colleague's enrolment id is 404'd (indistinguishable from not-found, so
    // ids are not enumerable).
    const isPrivileged = ["hr_admin", "hr_officer", "super_admin", "manager"].some((r) => ctx.roles.includes(r));
    if (!isPrivileged) {
      const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
      if (!actorEmp || actorEmp.id !== row.employeeId) throw new HttpError(404, "NOT_FOUND", "enrollment not found");
    }
    return reply.send(row);
  });

  app.patch("/v1/hrms/learning/enrollments/:id/progress", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      percentComplete: z.number().int().min(0).max(100),
      lastActivityAt:  z.string().optional(),
    }).parse(req.body);
    const existing = await repo.getEnrollmentById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "enrollment not found");
    // GAP2-LEARNING-ENROLLMENTS-IDOR-01: a bare employee may only write
    // progress on their OWN enrolment; otherwise an employee could overwrite a
    // colleague's progress/status to completed. HR/manager pass through.
    const isPrivileged = ["hr_admin", "hr_officer", "super_admin", "manager"].some((r) => ctx.roles.includes(r));
    if (!isPrivileged) {
      const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
      if (!actorEmp || actorEmp.id !== existing.employeeId) throw new HttpError(404, "NOT_FOUND", "enrollment not found");
    }
    const pct = body.percentComplete;
    const status = pct >= 100 ? "completed" : pct > 0 ? "in_progress" : "enrolled";
    await publishF3Write(ctx, "learning_routes__10", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    // progressPct/status are computed above from the request body, independent
    // of the (now-deferred) write, so they're safe to echo synchronously.
    return reply.code(202).send({ id, progressPct: pct, status }) as any;
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
