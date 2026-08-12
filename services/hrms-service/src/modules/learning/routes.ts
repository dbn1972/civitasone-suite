import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
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
    const row = await publishF3Write(ctx, "learning_routes__0", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: row.id, code: row.code, status: row.status }) as any;
  });

  app.get("/v1/hrms/learning/courses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { q } = z.object({ q: z.string().max(128).optional() }).parse(req.query);
    return reply.send(await repo.listCourses(ctx.tenantId, q));
  });

  app.get("/v1/hrms/learning/courses/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const course = await repo.getCourse(ctx.tenantId, id);
    if (!course) throw new HttpError(404, "NOT_FOUND", "course not found");
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
    const row = await publishF3Write(ctx, "learning_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    if (!row) throw new HttpError(409, "INVALID_STATE", "only a draft course can be published") as any;
    return reply.send({ id, status: row.status });
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
    await publishF3Write(ctx, "learning_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
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
    const row = await publishF3Write(ctx, "learning_routes__3", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: row.id, courseId: id, sequence: row.sequence }) as any;
  });

  app.post("/v1/hrms/learning/modules/:id/lessons", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = createLessonBody.parse(req.body);
    const mod = await repo.getModule(ctx.tenantId, id);
    if (!mod) throw new HttpError(404, "NOT_FOUND", "module not found");
    const row = await publishF3Write(ctx, "learning_routes__4", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: row.id, moduleId: id, contentType: row.contentType }) as any;
  });

  // ── Enrolment + progress tracking ───────────────────────────────
  app.post("/v1/hrms/learning/courses/:id/enroll", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = enrollBody.parse(req.body);
    const course = await repo.getCourse(ctx.tenantId, id);
    if (!course) throw new HttpError(404, "NOT_FOUND", "course not found");
    if (course.status !== "published") throw new HttpError(409, "NOT_PUBLISHED", "course is not published");

    // Prerequisite gate.
    const [prereqIds, doneCourses] = await Promise.all([
      repo.listPrerequisiteIds(ctx.tenantId, id),
      repo.completedCourseIds(ctx.tenantId, body.employeeId),
    ]);
    const check = checkPrerequisites(prereqIds, doneCourses);
    if (!check.met) {
      return reply.code(409).send({ code: "PREREQUISITES_NOT_MET", message: "prerequisite courses not completed", missing: check.missing });
    }
    const existing = await repo.getEnrollment(ctx.tenantId, id, body.employeeId);
    if (existing) return reply.code(200).send({ id: existing.id, status: existing.status, progressPct: existing.progressPct });
    const row = await publishF3Write(ctx, "learning_routes__5", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    if (!row) {
      // Lost the race — a concurrent enrolment already created the row.
      const again = await repo.getEnrollment(ctx.tenantId, id, body.employeeId) as any;
      return reply.code(200).send({ id: again!.id, status: again!.status, progressPct: again!.progressPct });
    }
    return reply.code(201).send({ id: row.id, status: row.status, progressPct: row.progressPct });
  });

  app.post("/v1/hrms/learning/lessons/:id/progress", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = lessonProgressBody.parse(req.body);
    const lesson = await repo.getLesson(ctx.tenantId, id);
    if (!lesson) throw new HttpError(404, "NOT_FOUND", "lesson not found");
    const enrollment = await repo.getEnrollment(ctx.tenantId, lesson.courseId, body.employeeId);
    if (!enrollment) throw new HttpError(409, "NOT_ENROLLED", "employee is not enrolled in this course");

    const result = await publishF3Write(ctx, "learning_routes__6", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({
      enrollmentId: enrollment.id, progressPct: result!.progressPct,
      status: result!.status, resumeLessonId: result!.resumeLessonId,
    }) as any;
  });

  app.get("/v1/hrms/learning/my-learning", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { employeeId } = z.object({ employeeId: z.string().uuid() }).parse(req.query);
    return reply.send(await repo.listMyEnrollments(ctx.tenantId, employeeId));
  });


  // ── LMS Dashboard stats ─────────────────────────────────────────
  // Returns enrolled/in_progress/completed/overdue counts, optionally scoped
  // to a single employee (add ?employeeId=<uuid>).
  app.get("/v1/hrms/learning/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { employeeId } = z.object({ employeeId: z.string().uuid().optional() }).parse(req.query);
    const [statusCounts, overdueCount] = await Promise.all([
      repo.countEnrollmentsByStatus(ctx.tenantId, employeeId),
      repo.countOverdueEnrollments(ctx.tenantId, employeeId),
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
    const updateData = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as Parameters<typeof repo.updateCourse>[3];
    const updated = await db.transaction(async (tx) => repo.updateCourse(tx, ctx.tenantId, id, updateData));
    if (!updated) throw new HttpError(409, "INVALID_STATE", "course could not be updated");
    return reply.send({ id: updated.id, title: updated.title, status: updated.status });
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
    return reply.send(await repo.listTrainingPlans(ctx.tenantId));
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
    const { randomUUID } = await import("node:crypto");
    const id = randomUUID();
    const row = await db.transaction(async (tx) => repo.insertTrainingPlan(tx, {
      id, tenantId: ctx.tenantId, title: body.title,
      planYear: body.planYear,
      departmentId: body.departmentId ?? null,
      roleCode: body.roleCode ?? null,
      status: "draft", createdBy: ctx.actorId,
    }));
    return reply.code(201).send({ id: row.id, status: row.status });
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
    const { randomUUID } = await import("node:crypto");
    const itemId = randomUUID();
    const row = await db.transaction(async (tx) => repo.insertTrainingPlanItem(tx, {
      id: itemId, tenantId: ctx.tenantId, planId: id,
      courseId: body.courseId ?? null, trainingId: body.trainingId ?? null,
      targetDate: body.targetDate ?? null, mandatory: body.mandatory ? 1 : 0,
    }));
    return reply.code(201).send({ id: row.id, planId: id });
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
