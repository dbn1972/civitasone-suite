import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Onboarding tasks CRUD (T19) + buddy assignment (T20).
 *
 *   POST /v1/hrms/employees/:id/onboarding-tasks   add a task
 *   GET  /v1/hrms/employees/:id/onboarding-tasks   list tasks
 *   PATCH /v1/hrms/onboarding-tasks/:taskId/complete  mark complete
 *   POST /v1/hrms/employees/:id/buddy              assign buddy/mentor
 *   GET  /v1/hrms/employees/:id/buddy              list buddy assignments
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, sql, inArray } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsOnboardingTasks, hrmsBuddyAssignments } from "./schema.js";
import { hrmsEmployees } from "../employee/schema.js";

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
    await publishF3Write(ctx, "lifecycle_onboarding_routes__0", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: tid, employeeId: id, status: "pending" }) as any;
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
    await publishF3Write(ctx, "lifecycle_onboarding_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id: taskId, status: "completed" }) as any;
  });

  app.post("/v1/hrms/employees/:id/buddy", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      buddyId: z.string().uuid(),
      role: z.enum(["buddy", "mentor"]).default("buddy"),
    }).parse(req.body);
    const bid = randomUUID();
    await publishF3Write(ctx, "lifecycle_onboarding_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: bid, employeeId: id, role: body.role }) as any;
  });

  app.get("/v1/hrms/employees/:id/buddy", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await scopedRead((tx) => tx.select().from(hrmsBuddyAssignments)
      .where(and(eq(hrmsBuddyAssignments.tenantId, ctx.tenantId), eq(hrmsBuddyAssignments.employeeId, id))));
    return reply.send({ data: rows });
  });


  // GET /v1/hrms/onboarding — tenant-wide onboarding summary (one row per employee with tasks)
  app.get("/v1/hrms/onboarding", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);

    const tasks = await scopedRead((tx) => tx.select().from(hrmsOnboardingTasks)
      .where(eq(hrmsOnboardingTasks.tenantId, ctx.tenantId)).limit(2000));

    if (tasks.length === 0) return reply.send({ data: [] });

    const empIds = [...new Set(tasks.map((t) => t.employeeId))];
    const employees = await scopedRead((tx) => tx
      .select({ id: hrmsEmployees.id, fullName: hrmsEmployees.fullName, employeeNo: hrmsEmployees.employeeNo, departmentId: hrmsEmployees.departmentId, dateOfJoining: hrmsEmployees.dateOfJoining })
      .from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), inArray(hrmsEmployees.id, empIds))));

    const empMap = new Map(employees.map((e) => [e.id, e]));
    const grouped = new Map<string, typeof tasks>();
    for (const t of tasks) {
      if (!grouped.has(t.employeeId)) grouped.set(t.employeeId, []);
      grouped.get(t.employeeId)!.push(t);
    }

    const now = new Date();
    const data = empIds.map((empId) => {
      const emp = empMap.get(empId);
      const empTasks = grouped.get(empId) ?? [];
      const total = empTasks.length;
      const completed = empTasks.filter((t) => t.status === "completed").length;
      const todayStr = now.toISOString().slice(0, 10); // "YYYY-MM-DD" in UTC
      const overdue = empTasks.filter((t) => {
        if (t.status === "completed" || !emp?.dateOfJoining) return false;
        // Both sides are date-only strings or Date objects from a date column;
        // compute due date in UTC to avoid local-tz midnight hazard.
        const join = new Date(emp.dateOfJoining + "T00:00:00Z");
        const due = new Date(join);
        due.setUTCDate(due.getUTCDate() + t.dueByDay);
        return due.toISOString().slice(0, 10) < todayStr;
      }).length;
      const status = completed === total ? "completed" : overdue > 0 ? "overdue" : "in_progress";
      return {
        id: empId,
        employee: emp?.fullName ?? "—",
        employeeNo: emp?.employeeNo ?? "—",
        department: emp?.departmentId ?? "—",
        joiningDate: emp?.dateOfJoining ?? "—",
        stepsCompleted: `${completed}/${total}`,
        totalSteps: String(total),
        progress: total > 0 ? `${Math.round((completed / total) * 100)}%` : "0%",
        status,
      };
    });

    return reply.send({ data });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
