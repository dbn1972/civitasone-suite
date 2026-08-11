/**
 * Department + Designation master CRUD — needed for first-time tenant setup
 * so employees can be properly classified.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsDepartments, hrmsDesignations } from "./schema.js";

const HR_READ_ROLES = ["hr_admin", "hr_officer", "super_admin", "admin", "manager"];
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
    const [deptRow] = await scopedRead((tx) => tx.insert(hrmsDepartments).values({
      tenantId: ctx.tenantId, code: body.code, name: body.name,
      parentId: body.parentId ?? null, type: body.type ?? null, level: body.level ?? null,
      govtTier: body.govtTier ?? null, locationId: body.locationId ?? null, headEmployeeId: body.headEmployeeId ?? null,
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    }).returning({ id: hrmsDepartments.id }));
    const id = deptRow!.id;
    return reply.code(201).send({ id, status: "created" }) as any;
  });
  app.patch("/v1/hrms/departments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = req.params as { id: string };
    const body = createDeptBody.partial().parse(req.body);
    const patch = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    const [updated] = await scopedRead((tx) =>
      tx.update(hrmsDepartments)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .set({ ...patch, updatedBy: ctx.actorId } as any)
        .where(eq(hrmsDepartments.id, id))
        .returning({ id: hrmsDepartments.id })
    );
    if (!updated) return reply.code(404).send({ code: "NOT_FOUND", message: "Department not found" });
    return reply.send({ id, status: "updated" });
  });

  app.delete("/v1/hrms/departments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = req.params as { id: string };
    const [deleted] = await scopedRead((tx) =>
      tx.delete(hrmsDepartments)
        .where(eq(hrmsDepartments.id, id))
        .returning({ id: hrmsDepartments.id })
    );
    if (!deleted) return reply.code(404).send({ code: "NOT_FOUND", message: "Department not found" });
    return reply.code(204).send();
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
    const [desigRow] = await scopedRead((tx) => tx.insert(hrmsDesignations).values({
      tenantId: ctx.tenantId, code: body.code, name: body.name,
      level: body.level ?? 0, payGrade: body.payGrade ?? null,
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    }).returning({ id: hrmsDesignations.id }));
    const id = desigRow!.id;
    return reply.code(201).send({ id, status: "created" }) as any;
  });
  app.patch("/v1/hrms/designations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = req.params as { id: string };
    const body = createDesignationBody.partial().parse(req.body);
    const patch = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    const [updated] = await scopedRead((tx) =>
      tx.update(hrmsDesignations)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .set({ ...patch, updatedBy: ctx.actorId } as any)
        .where(eq(hrmsDesignations.id, id))
        .returning({ id: hrmsDesignations.id })
    );
    if (!updated) return reply.code(404).send({ code: "NOT_FOUND", message: "Designation not found" });
    return reply.send({ id, status: "updated" });
  });

  app.delete("/v1/hrms/designations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = req.params as { id: string };
    const [deleted] = await scopedRead((tx) =>
      tx.delete(hrmsDesignations)
        .where(eq(hrmsDesignations.id, id))
        .returning({ id: hrmsDesignations.id })
    );
    if (!deleted) return reply.code(404).send({ code: "NOT_FOUND", message: "Designation not found" });
    return reply.code(204).send();
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
