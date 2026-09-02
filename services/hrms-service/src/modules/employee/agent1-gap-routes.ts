import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
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
import { validateManagerAssignment, type ManagerGraph } from "./manager-domain.js";

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

    // Synchronous pre-check (existence): the consumer's employee_agent1_gap_routes__0
    // case already 404s when the employee is missing, but only AFTER the route has
    // replied 200 — the client would see a false-positive success while the write is
    // silently dropped. Mirror the check here so an invalid id gets a real 404.
    const existsRows = await scopedRead((tx) =>
      tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
        .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, ctx.tenantId)))
        .limit(1),
    );
    if (!existsRows[0]) throw new HttpError(404, "NOT_FOUND", "employee not found");

    const result = await publishF3Write(ctx, "employee_agent1_gap_routes__0", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ data: { id, fitnessStatus: body.fitnessStatus } }) as any;
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
    // migration 0025_employee_status_contract.sql retired "active" in favor of
    // "confirmed" and migrated every existing row; comparing against "active"
    // here made this guard permanently unreachable (no row can ever match),
    // silently allowing repeat activation of an already-confirmed employee.
    if (emp.status === "confirmed") {
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
    await publishF3Write(ctx, "employee_agent1_gap_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    // "active" was retired by migration 0025_employee_status_contract.sql in
    // favor of "confirmed" — the consumer now writes "confirmed" (see
    // f3-consumer.ts's employee_agent1_gap_routes__1), so echo the same value
    // here rather than reporting a status the row will never actually hold.
    return reply.send({ data: { id, status: "confirmed" } }) as any;
  });

  // ── 0195: No-show reversal workflow ─────────────────────────────────────────
  // An employee marked as "no_show" can be reversed back to probation/confirmed
  // if they report within the allowed window.
  app.post("/v1/hrms/employees/:id/reverse-no-show", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      reason: z.string().min(1).max(2000),
      // "active" was retired by migration 0025_employee_status_contract.sql in
      // favor of "confirmed" and is not in hrms_employees_status_check; the
      // consumer (f3-consumer.ts, employee_agent1_gap_routes__2) writes this
      // value verbatim, so allowing "active" here reproduces the same
      // silent-rollback bug as the activate path (f3-consumer.ts:115).
      revertToStatus: z.enum(["probation", "confirmed"]).default("probation"),
    }).parse(req.body);

    // Synchronous pre-check (state-transition legality): the consumer's
    // employee_agent1_gap_routes__2 case rejects with 404/409 when the employee is
    // missing or not in 'no_show' status, but only after the route has already
    // replied 200. Lift the same check here so an illegal reversal gets a real
    // 4xx instead of a silently dropped/DLQ'd write.
    const noShowRows = await scopedRead((tx) =>
      tx.select({ id: hrmsEmployees.id, status: hrmsEmployees.status }).from(hrmsEmployees)
        .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, ctx.tenantId)))
        .limit(1),
    );
    const noShowEmp = noShowRows[0];
    if (!noShowEmp) throw new HttpError(404, "NOT_FOUND", "employee not found");
    if (noShowEmp.status !== "no_show") {
      throw new HttpError(409, "WRONG_STATE", `employee status is '${noShowEmp.status}', not 'no_show'`);
    }

    // publishF3Write only ever returns a generic { id, status: "accepted",
    // correlationId } acknowledgement (see f3-publish.ts) -- it cannot know the
    // post-write row state synchronously. Echoing that ack verbatim as `data`
    // claimed status "accepted" instead of the reverted status the consumer
    // (employee_agent1_gap_routes__2) actually writes. revertToStatus is
    // already known and validated at this point, so report it directly --
    // same fix already applied to 0175/0180 above.
    await publishF3Write(ctx, "employee_agent1_gap_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ data: { id, status: body.revertToStatus } }) as any;
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

    const mgrRows = await scopedRead((tx) =>
      tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
        .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, ctx.tenantId)))
        .limit(1),
    );
    if (!mgrRows[0]) throw new HttpError(404, "NOT_FOUND", "employee not found");

    // Synchronous pre-check (0230, cycle detection): the consumer's
    // employee_agent1_gap_routes__3 case builds the tenant's reporting graph and
    // rejects a proposed manager that would create a circular chain with 422
    // CYCLE_DETECTED, but only after the route has already replied 200 — the
    // client sees a false-positive success while the write is silently dropped.
    // Mirror the same check here, synchronously, before publishing the write.
    const allEdges = await scopedRead((tx) =>
      tx.select({ eid: hrmsEmployees.id, mgr: hrmsEmployees.managerId })
        .from(hrmsEmployees)
        .where(eq(hrmsEmployees.tenantId, ctx.tenantId)),
    );
    const graph: ManagerGraph = { edges: new Map(allEdges.map((e) => [e.eid, e.mgr])) };
    const cycle = validateManagerAssignment(graph, id, {
      managerId: body.managerId,
      functionalManagerId: body.functionalManagerId,
      projectManagerId: body.projectManagerId,
    });
    if (cycle) {
      throw new HttpError(422, "CYCLE_DETECTED", `assigning ${cycle.field} '${cycle.managerId}' would create a circular reporting chain`);
    }

    // Same publishF3Write response-shape gap as reverse-no-show above: the
    // generic { status: "accepted" } ack was echoed as `data`, so callers
    // never saw the manager ids they had just assigned. The consumer
    // (employee_agent1_gap_routes__3) returns { id: targetId, ...body } --
    // mirror that with the already zod-validated `body` here.
    await publishF3Write(ctx, "employee_agent1_gap_routes__3", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ data: { id, ...body } }) as any;
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
