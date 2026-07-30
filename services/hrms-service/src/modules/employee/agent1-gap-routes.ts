/**
 * Agent 1 HRMS gap-closure routes:
 *   0175 — GET/PATCH fitness_status on employee
 *   0180 — POST activate gate (mandatory-condition check)
 *   0195 — POST no-show reversal workflow
 *   0227 — PATCH functional_manager_id + project_manager_id
 *   0230 — Cycle-detection on manager assignment (integrated into PATCH)
 *   0233 — GET span-of-control analytics
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsEmployees } from "./schema.js";
import { checkMandatoryConditions } from "./activation-domain.js";
import { wouldCreateCycle, type ManagerGraph } from "./manager-domain.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const READER_ROLES = [...HR_ROLES, "manager"];
const idParam = z.object({ id: z.string().uuid() });

const FITNESS_VALUES = ["fit", "unfit", "temporary_unfit", "pending", "exempt"] as const;

export async function agent1GapRoutes(app: FastifyInstance): Promise<void> {
  // ── 0175: Update fitness_status ─────────────────────────────────────────────
  app.patch("/v1/hrms/employees/:id/fitness-status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      fitnessStatus: z.enum(FITNESS_VALUES),
    }).parse(req.body);

    const result = await db.transaction(async (tx) => {
      const rows = await tx.select({ id: hrmsEmployees.id, version: hrmsEmployees.version })
        .from(hrmsEmployees)
        .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, ctx.tenantId)))
        .limit(1);
      if (!rows[0]) throw new HttpError(404, "NOT_FOUND", "employee not found");
      const updated = await tx.update(hrmsEmployees)
        .set({ fitnessStatus: body.fitnessStatus, updatedBy: ctx.actorId, updatedAt: new Date() })
        .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.version, rows[0].version)));
      return updated;
    });
    return reply.send({ data: { id, fitnessStatus: body.fitnessStatus } });
  });

  // ── 0180: Activation gate (mandatory-condition check) ───────────────────────
  app.post("/v1/hrms/employees/:id/activate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);

    const rows = await scopedRead((tx) =>
      tx.select().from(hrmsEmployees)
        .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, ctx.tenantId)))
        .limit(1),
    );
    const emp = rows[0];
    if (!emp) throw new HttpError(404, "NOT_FOUND", "employee not found");
    if (emp.status === "active") {
      throw new HttpError(409, "ALREADY_ACTIVE", "employee is already active");
    }

    const result = checkMandatoryConditions({
      id: emp.id,
      fullName: emp.fullName,
      fitnessStatus: emp.fitnessStatus ?? null,
      departmentId: emp.departmentId ?? null,
      designationId: emp.designationId ?? null,
      dateOfJoining: emp.dateOfJoining ?? null,
      bankAccountNo: emp.bankAccountNo ?? null,
      pan: emp.pan ?? null,
      employeeType: emp.employeeType,
    });

    if (!result.canActivate) {
      return reply.code(422).send({
        code: "ACTIVATION_BLOCKED",
        message: "mandatory conditions not met",
        failures: result.failures,
      });
    }

    // All conditions met — activate
    await db.transaction(async (tx) => {
      await tx.update(hrmsEmployees)
        .set({ status: "active", updatedBy: ctx.actorId, updatedAt: new Date() })
        .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.version, emp.version)));
    });
    return reply.send({ data: { id, status: "active" } });
  });

  // ── 0195: No-show reversal workflow ─────────────────────────────────────────
  // An employee marked as "no_show" can be reversed back to probation/active
  // if they report within the allowed window.
  app.post("/v1/hrms/employees/:id/reverse-no-show", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      reason: z.string().min(1).max(2000),
      revertToStatus: z.enum(["probation", "active"]).default("probation"),
    }).parse(req.body);

    const result = await db.transaction(async (tx) => {
      const rows = await tx.select({ id: hrmsEmployees.id, status: hrmsEmployees.status, version: hrmsEmployees.version })
        .from(hrmsEmployees)
        .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, ctx.tenantId)))
        .limit(1);
      const emp = rows[0];
      if (!emp) throw new HttpError(404, "NOT_FOUND", "employee not found");
      if (emp.status !== "no_show") {
        throw new HttpError(409, "WRONG_STATE", `employee status is '${emp.status}', not 'no_show'`);
      }
      await tx.update(hrmsEmployees)
        .set({ status: body.revertToStatus, updatedBy: ctx.actorId, updatedAt: new Date() })
        .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.version, emp.version)));
      return { id, status: body.revertToStatus };
    });
    return reply.send({ data: result });
  });

  // ── 0227 + 0230: Assign functional/project managers (with cycle detection) ──
  app.patch("/v1/hrms/employees/:id/managers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      managerId: z.string().uuid().nullish(),
      functionalManagerId: z.string().uuid().nullish(),
      projectManagerId: z.string().uuid().nullish(),
    }).refine((b) => b.managerId !== undefined || b.functionalManagerId !== undefined || b.projectManagerId !== undefined, {
      message: "at least one manager field must be provided",
    }).parse(req.body);

    const result = await db.transaction(async (tx) => {
      // Fetch current employee
      const rows = await tx.select({
        id: hrmsEmployees.id,
        version: hrmsEmployees.version,
        managerId: hrmsEmployees.managerId,
        tenantId: hrmsEmployees.tenantId,
      }).from(hrmsEmployees)
        .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, ctx.tenantId)))
        .limit(1);
      const emp = rows[0];
      if (!emp) throw new HttpError(404, "NOT_FOUND", "employee not found");

      // Build a lightweight manager graph for cycle detection
      // Fetch all employees' manager edges in this tenant
      const allEdges = await tx.select({
        eid: hrmsEmployees.id,
        mgr: hrmsEmployees.managerId,
      }).from(hrmsEmployees)
        .where(eq(hrmsEmployees.tenantId, ctx.tenantId));

      const graph: ManagerGraph = {
        edges: new Map(allEdges.map((e) => [e.eid, e.mgr])),
      };

      // Validate each proposed manager for cycles
      const updates: Record<string, unknown> = { updatedBy: ctx.actorId, updatedAt: new Date() };

      if (body.managerId !== undefined) {
        if (body.managerId && wouldCreateCycle(graph, id, body.managerId)) {
          throw new HttpError(422, "CYCLE_DETECTED", `assigning manager '${body.managerId}' would create a circular reporting chain`);
        }
        updates.managerId = body.managerId ?? null;
      }
      if (body.functionalManagerId !== undefined) {
        if (body.functionalManagerId && wouldCreateCycle(graph, id, body.functionalManagerId)) {
          throw new HttpError(422, "CYCLE_DETECTED", `assigning functional manager '${body.functionalManagerId}' would create a circular reporting chain`);
        }
        updates.functionalManagerId = body.functionalManagerId ?? null;
      }
      if (body.projectManagerId !== undefined) {
        if (body.projectManagerId && wouldCreateCycle(graph, id, body.projectManagerId)) {
          throw new HttpError(422, "CYCLE_DETECTED", `assigning project manager '${body.projectManagerId}' would create a circular reporting chain`);
        }
        updates.projectManagerId = body.projectManagerId ?? null;
      }

      await tx.update(hrmsEmployees).set(updates)
        .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.version, emp.version)));

      return { id, ...body };
    });
    return reply.send({ data: result });
  });

  // ── 0233: Span-of-control analytics endpoint ────────────────────────────────
  app.get("/v1/hrms/analytics/span-of-control", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const query = z.object({
      departmentId: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(req.query);

    // Count direct reports per manager
    const rows = await scopedRead(async (tx) => {
      const deptFilter = query.departmentId
        ? sql`AND e.department_id = ${query.departmentId}`
        : sql``;

      const result = await tx.execute(sql`
        SELECT
          m.id AS manager_id,
          m.full_name AS manager_name,
          m.department_id,
          COUNT(e.id)::int AS direct_reports,
          COUNT(e.id) FILTER (WHERE e.manager_id = m.id)::int AS reporting_line_reports,
          COUNT(e.id) FILTER (WHERE e.functional_manager_id = m.id)::int AS functional_reports,
          COUNT(e.id) FILTER (WHERE e.project_manager_id = m.id)::int AS project_reports
        FROM employee.hrms_employees m
        LEFT JOIN employee.hrms_employees e
          ON e.tenant_id = m.tenant_id
          AND (e.manager_id = m.id OR e.functional_manager_id = m.id OR e.project_manager_id = m.id)
          AND e.status IN ('active','probation')
          ${deptFilter}
        WHERE m.tenant_id = ${ctx.tenantId}
          AND m.status IN ('active','probation')
        GROUP BY m.id, m.full_name, m.department_id
        HAVING COUNT(e.id) > 0
        ORDER BY COUNT(e.id) DESC
        LIMIT ${query.limit}
      `);
      return result;
    });

    return reply.send({ data: rows });
  });

  // Error handler
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
