/**
 * Onboarding tasks CRUD (T19) + buddy assignment (T20).
 *
 *   POST /v1/hrms/employees/:id/onboarding-tasks   add a task
 *   GET  /v1/hrms/employees/:id/onboarding-tasks   list tasks
 *   PATCH /v1/hrms/onboarding-tasks/:taskId/complete  mark complete
 *   POST /v1/hrms/employees/:id/buddy              assign buddy/mentor
 *   GET  /v1/hrms/employees/:id/buddy              list buddy assignments
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsOnboardingTasks, hrmsBuddyAssignments } from "./schema.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const taskParam = z.object({ taskId: z.string().uuid() });

export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/employees/:id/onboarding-tasks", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      title: z.string().min(1).max(200),
      dueByDay: z.coerce.number().int().min(1).max(365),
      assignedTo: z.string().uuid().optional(),
    }).parse(req.body);
    const tid = randomUUID();
    await db.transaction((tx) => tx.insert(hrmsOnboardingTasks).values({
      id: tid, tenantId: ctx.tenantId, employeeId: id,
      title: body.title, dueByDay: body.dueByDay, assignedTo: body.assignedTo ?? null,
      createdBy: ctx.actorId,
    }));
    return reply.code(201).send({ id: tid, employeeId: id, status: "pending" });
  });

  app.get("/v1/hrms/employees/:id/onboarding-tasks", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await scopedRead((tx) => tx.select().from(hrmsOnboardingTasks)
      .where(and(eq(hrmsOnboardingTasks.tenantId, ctx.tenantId), eq(hrmsOnboardingTasks.employeeId, id))));
    return reply.send({ data: rows });
  });

  app.patch("/v1/hrms/onboarding-tasks/:taskId/complete", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { taskId } = taskParam.parse(req.params);
    await db.transaction((tx) => tx.update(hrmsOnboardingTasks)
      .set({ status: "completed", completedAt: new Date(), version: sql`${hrmsOnboardingTasks.version} + 1` })
      .where(and(eq(hrmsOnboardingTasks.tenantId, ctx.tenantId), eq(hrmsOnboardingTasks.id, taskId))));
    return reply.send({ id: taskId, status: "completed" });
  });

  app.post("/v1/hrms/employees/:id/buddy", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      buddyId: z.string().uuid(),
      role: z.enum(["buddy", "mentor"]).default("buddy"),
    }).parse(req.body);
    const bid = randomUUID();
    await db.transaction((tx) => tx.insert(hrmsBuddyAssignments).values({
      id: bid, tenantId: ctx.tenantId, employeeId: id, ...body, createdBy: ctx.actorId,
    }));
    return reply.code(201).send({ id: bid, employeeId: id, role: body.role });
  });

  app.get("/v1/hrms/employees/:id/buddy", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await scopedRead((tx) => tx.select().from(hrmsBuddyAssignments)
      .where(and(eq(hrmsBuddyAssignments.tenantId, ctx.tenantId), eq(hrmsBuddyAssignments.employeeId, id))));
    return reply.send({ data: rows });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
