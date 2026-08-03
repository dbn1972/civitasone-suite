import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Employee nominees (T04) + addresses (T05) CRUD.
 *
 *   POST /v1/hrms/employees/:id/nominees        add a nominee
 *   GET  /v1/hrms/employees/:id/nominees        list nominees
 *   POST /v1/hrms/employees/:id/addresses       add an address
 *   GET  /v1/hrms/employees/:id/addresses       list addresses (current first)
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsEmployeeNominees, hrmsEmployeeAddresses } from "./schema.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });

export async function nomineeAddressRoutes(app: FastifyInstance): Promise<void> {
  // ── Nominees ──
  app.post("/v1/hrms/employees/:id/nominees", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      name: z.string().min(1).max(200),
      relationship: z.string().min(1).max(64),
      dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      sharePercent: z.coerce.number().int().min(0).max(100).optional(),
      contactPhone: z.string().max(20).optional(),
      purpose: z.enum(["general", "gpf", "pension", "gratuity", "insurance"]).default("general"),
    }).parse(req.body);
    const nid = randomUUID();
    await publishF3Write(ctx, "employee_nominee_address_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: nid, employeeId: id });
  });

  app.get("/v1/hrms/employees/:id/nominees", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await scopedRead((tx) => tx.select().from(hrmsEmployeeNominees)
      .where(and(eq(hrmsEmployeeNominees.tenantId, ctx.tenantId), eq(hrmsEmployeeNominees.employeeId, id))));
    return reply.send({ data: rows });
  });

  // ── Addresses ──
  app.post("/v1/hrms/employees/:id/addresses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      addressType: z.enum(["permanent", "correspondence", "present", "hometown"]),
      line1: z.string().min(1).max(500),
      line2: z.string().max(500).optional(),
      city: z.string().max(100).optional(),
      state: z.string().max(100).optional(),
      pincode: z.string().max(10).optional(),
      country: z.string().max(64).default("IN"),
      isCurrent: z.boolean().default(true),
      effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(req.body);
    const aid = randomUUID();
    await publishF3Write(ctx, "employee_nominee_address_routes__1", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: aid, employeeId: id });
  });

  app.get("/v1/hrms/employees/:id/addresses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await scopedRead((tx) => tx.select().from(hrmsEmployeeAddresses)
      .where(and(eq(hrmsEmployeeAddresses.tenantId, ctx.tenantId), eq(hrmsEmployeeAddresses.employeeId, id)))
      .orderBy(desc(hrmsEmployeeAddresses.isCurrent)));
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
