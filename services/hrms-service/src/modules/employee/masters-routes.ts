/**
 * Department + Designation master CRUD — needed for first-time tenant setup
 * so employees can be properly classified.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsDepartments, hrmsDesignations } from "./schema.js";

const HR_ROLES = ["hr_admin", "super_admin", "admin"];

const createDeptBody = z.object({
  code: z.string().min(1, "Department code is required").max(20),
  name: z.string().min(2, "Department name is required").max(200),
  parentId: z.string().uuid().optional(),
  type: z.string().min(1).max(40).optional(),
  level: z.number().int().min(0).optional(),
  govtTier: z.enum(["central", "state", "local_body", "statutory_body", "autonomous_body"]).optional(),
  locationId: z.string().uuid().optional(),
  headEmployeeId: z.string().uuid().optional(),
});

const createDesignationBody = z.object({
  code: z.string().min(1, "Designation code is required").max(20),
  name: z.string().min(2, "Designation name is required").max(200),
  level: z.number().int().nonnegative().optional(),
  payGrade: z.string().max(30).optional(),
});

export async function mastersRoutes(app: FastifyInstance): Promise<void> {
  // ── Departments ──
  app.get("/v1/hrms/departments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(hrmsDepartments).where(eq(hrmsDepartments.tenantId, ctx.tenantId)));
    return reply.send({ data: rows });
  });

  app.post("/v1/hrms/departments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createDeptBody.parse(req.body);
    // Hierarchy enforcement: if parent is specified + both have levels, child must be deeper.
    if (body.parentId && body.level !== undefined) {
      const parent = await scopedRead((tx) => tx.select().from(hrmsDepartments)
        .where(eq(hrmsDepartments.id, body.parentId as string)).limit(1));
      if (parent[0]?.level != null && body.level <= parent[0].level) {
        return reply.code(400).send({
          code: "HIERARCHY_VIOLATION",
          message: `Child level (${body.level}) must be greater than parent level (${parent[0].level})`,
        });
      }
    }
    const id = randomUUID();
    await db.transaction((tx) => tx.insert(hrmsDepartments).values({
      id, tenantId: ctx.tenantId, code: body.code, name: body.name,
      parentId: body.parentId ?? null,
      ...(body.type ? { type: body.type } : {}),
      ...(body.level !== undefined ? { level: body.level } : {}),
      ...(body.govtTier ? { govtTier: body.govtTier } : {}),
      ...(body.locationId ? { locationId: body.locationId } : {}),
      ...(body.headEmployeeId ? { headEmployeeId: body.headEmployeeId } : {}),
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    }));
    return reply.code(201).send({ id, status: "created" });
  });

  // ── Designations ──
  app.get("/v1/hrms/designations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(hrmsDesignations).where(eq(hrmsDesignations.tenantId, ctx.tenantId)));
    return reply.send({ data: rows });
  });

  app.post("/v1/hrms/designations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createDesignationBody.parse(req.body);
    const id = randomUUID();
    await db.transaction((tx) => tx.insert(hrmsDesignations).values({
      id, tenantId: ctx.tenantId, code: body.code, name: body.name,
      level: body.level ?? 0, payGrade: body.payGrade ?? null,
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    }));
    return reply.code(201).send({ id, status: "created" });
  });

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
