/**
 * Department + Designation master CRUD — needed for first-time tenant setup
 * so employees can be properly classified.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { publishF3Write } from "../../shared/f3-publish.js";
import { hrmsDepartments, hrmsDesignations } from "./schema.js";

const HR_READ_ROLES = [
  "hr_admin",
  "hr_officer",
  "super_admin",
  "admin",
  "manager",
  // Finance/payroll roles need department names to submit PFMS salary bills
  // and payment advices (see apps/web finance/pfms/SalaryBillForm.tsx).
  "finance_officer",
  "finance_admin",
  "payroll_admin",
];
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
    requireRole(ctx, HR_READ_ROLES);
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
    await publishF3Write(ctx, "employee_masters_routes__0", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "created" }) as any;
  });
  app.patch("/v1/hrms/departments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = req.params as { id: string };
    createDeptBody.partial().parse(req.body);

    // Synchronous pre-check (existence): the old conditional UPDATE WHERE id
    // 404'd when no row matched. Mirror that here — note (unchanged from the
    // original) this lookup is NOT tenant-scoped, matching the pre-existing
    // behaviour of the code being converted; not something this F3 fix set
    // out to change.
    const existing = await scopedRead((tx) => tx.select({ id: hrmsDepartments.id }).from(hrmsDepartments).where(eq(hrmsDepartments.id, id)).limit(1));
    if (!existing[0]) return reply.code(404).send({ code: "NOT_FOUND", message: "Department not found" });

    await publishF3Write(ctx, "employee_masters_routes__2", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "updated" }) as any;
  });

  app.delete("/v1/hrms/departments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = req.params as { id: string };

    // Synchronous pre-check (existence) — same reasoning as PATCH above.
    const existing = await scopedRead((tx) => tx.select({ id: hrmsDepartments.id }).from(hrmsDepartments).where(eq(hrmsDepartments.id, id)).limit(1));
    if (!existing[0]) return reply.code(404).send({ code: "NOT_FOUND", message: "Department not found" });

    await publishF3Write(ctx, "employee_masters_routes__3", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send();
  });


  // ── Designations ──
  app.get("/v1/hrms/designations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_READ_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(hrmsDesignations).where(eq(hrmsDesignations.tenantId, ctx.tenantId)));
    return reply.send({ data: rows });
  });

  app.post("/v1/hrms/designations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createDesignationBody.parse(req.body);
    const id = randomUUID();
    await publishF3Write(ctx, "employee_masters_routes__1", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "created" }) as any;
  });
  app.patch("/v1/hrms/designations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = req.params as { id: string };
    createDesignationBody.partial().parse(req.body);

    // Synchronous pre-check (existence) — same reasoning as departments PATCH
    // above (also not tenant-scoped in the original code being converted).
    const existing = await scopedRead((tx) => tx.select({ id: hrmsDesignations.id }).from(hrmsDesignations).where(eq(hrmsDesignations.id, id)).limit(1));
    if (!existing[0]) return reply.code(404).send({ code: "NOT_FOUND", message: "Designation not found" });

    await publishF3Write(ctx, "employee_masters_routes__4", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "updated" }) as any;
  });

  app.delete("/v1/hrms/designations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = req.params as { id: string };

    // Synchronous pre-check (existence) — same reasoning as above.
    const existing = await scopedRead((tx) => tx.select({ id: hrmsDesignations.id }).from(hrmsDesignations).where(eq(hrmsDesignations.id, id)).limit(1));
    if (!existing[0]) return reply.code(404).send({ code: "NOT_FOUND", message: "Designation not found" });

    await publishF3Write(ctx, "employee_masters_routes__5", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send();
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
