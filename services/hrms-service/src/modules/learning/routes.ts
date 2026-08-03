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
