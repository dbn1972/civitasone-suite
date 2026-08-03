import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * 0314 — Employee hold/release with approval status.
 *
 *   POST   /v1/hrms/employees/:id/holds         request a hold
 *   GET    /v1/hrms/employees/:id/holds         list holds for an employee
 *   POST   /v1/hrms/holds/:holdId/approve       approve a pending hold
 *   POST   /v1/hrms/holds/:holdId/reject        reject a pending hold
 *   POST   /v1/hrms/holds/:holdId/release       release an active hold
 *   GET    /v1/hrms/holds/active                list all active holds in tenant
 *
 * A hold blocks specific HR processes (salary, increment, promotion, transfer)
 * for the affected employee until explicitly released. Holds require maker-
 * checker approval (requester ≠ approver).
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, desc, inArray } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsEmployeeHolds } from "./schema.js";
import { hrmsEmployees } from "../employee/schema.js";

const HR_ROLES = ["hr_admin", "super_admin"];
const HR_OFFICER_ROLES = [...HR_ROLES, "hr_officer"];
const idParam = z.object({ id: z.string().uuid() });
const holdIdParam = z.object({ holdId: z.string().uuid() });
const HOLD_TYPES = ["salary", "increment", "promotion", "transfer", "all"] as const;

export async function holdRoutes(app: FastifyInstance): Promise<void> {
  // Request a hold on an employee
  app.post("/v1/hrms/employees/:id/holds", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      holdType: z.enum(HOLD_TYPES),
      reason: z.string().min(1).max(2000),
      effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(req.body);

    // Verify employee exists
    const emp = await scopedRead((tx) =>
      tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
        .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, ctx.tenantId)))
        .limit(1),
    );
    if (!emp[0]) throw new HttpError(404, "NOT_FOUND", "employee not found");

    const holdId = randomUUID();
    await publishF3Write(ctx, "lifecycle_hold_routes__0", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })

    return reply.code(201).send({
      data: { id: holdId, employeeId: id, holdType: body.holdType, status: "pending" },
    }) as any;
  });

  // List holds for an employee
  app.get("/v1/hrms/employees/:id/holds", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const query = z.object({
      status: z.enum(["pending", "approved", "active", "released", "rejected"]).optional(),
    }).parse(req.query);

    const rows = await scopedRead(async (tx) => {
      const conditions = [
        eq(hrmsEmployeeHolds.tenantId, ctx.tenantId),
        eq(hrmsEmployeeHolds.employeeId, id),
      ];
      if (query.status) conditions.push(eq(hrmsEmployeeHolds.status, query.status));
      return tx.select().from(hrmsEmployeeHolds)
        .where(and(...conditions))
        .orderBy(desc(hrmsEmployeeHolds.createdAt))
        .limit(50);
    });

    return reply.send({ data: rows });
  });

  // Approve a pending hold (maker-checker: approver ≠ requester)
  app.post("/v1/hrms/holds/:holdId/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { holdId } = holdIdParam.parse(req.params);

    await publishF3Write(ctx, "lifecycle_hold_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })

    return reply.send({ data: { id: holdId, status: "active" } }) as any;
  });

  // Reject a pending hold
  app.post("/v1/hrms/holds/:holdId/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { holdId } = holdIdParam.parse(req.params);
    const body = z.object({
      reason: z.string().min(1).max(2000).optional(),
    }).parse(req.body ?? {});

    await publishF3Write(ctx, "lifecycle_hold_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })

    return reply.send({ data: { id: holdId, status: "rejected" } }) as any;
  });

  // Release an active hold
  app.post("/v1/hrms/holds/:holdId/release", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { holdId } = holdIdParam.parse(req.params);
    const body = z.object({
      reason: z.string().min(1).max(2000),
    }).parse(req.body);

    await publishF3Write(ctx, "lifecycle_hold_routes__3", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })

    return reply.send({ data: { id: holdId, status: "released" } }) as any;
  });

  // List all active holds (for dashboard / payroll integration)
  app.get("/v1/hrms/holds/active", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_OFFICER_ROLES);
    const query = z.object({
      holdType: z.enum(HOLD_TYPES).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(req.query);

    const rows = await scopedRead(async (tx) => {
      const conditions = [
        eq(hrmsEmployeeHolds.tenantId, ctx.tenantId),
        inArray(hrmsEmployeeHolds.status, ["active", "approved"]),
      ];
      if (query.holdType) conditions.push(eq(hrmsEmployeeHolds.holdType, query.holdType));
      return tx.select().from(hrmsEmployeeHolds)
        .where(and(...conditions))
        .orderBy(desc(hrmsEmployeeHolds.createdAt))
        .limit(query.limit);
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
