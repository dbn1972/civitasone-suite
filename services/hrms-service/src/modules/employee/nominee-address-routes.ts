/**
 * Employee nominees (T04) + addresses (T05) CRUD.
 *
 *   POST /v1/hrms/employees/:id/nominees        add a nominee
 *   GET  /v1/hrms/employees/:id/nominees        list nominees
 *   POST /v1/hrms/employees/:id/addresses       add an address
 *   GET  /v1/hrms/employees/:id/addresses       list addresses (current first)
 */
import { randomUUID } from "node:crypto";
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
    await db.transaction((tx) => tx.insert(hrmsEmployeeNominees).values({
      id: nid, tenantId: ctx.tenantId, employeeId: id,
      name: body.name, relationship: body.relationship, purpose: body.purpose,
      dateOfBirth: body.dateOfBirth ?? null, sharePercent: body.sharePercent ?? null,
      contactPhone: body.contactPhone ?? null,
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    }));
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
    await db.transaction((tx) => tx.insert(hrmsEmployeeAddresses).values({
      id: aid, tenantId: ctx.tenantId, employeeId: id,
      addressType: body.addressType, line1: body.line1, line2: body.line2 ?? null,
      city: body.city ?? null, state: body.state ?? null, pincode: body.pincode ?? null,
      country: body.country, isCurrent: body.isCurrent, effectiveFrom: body.effectiveFrom ?? null,
      createdBy: ctx.actorId,
    }));
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
