import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * 0176 — COI / confidentiality declaration routes.
 *
 *   POST   /v1/hrms/employees/:id/declarations        file a declaration
 *   GET    /v1/hrms/employees/:id/declarations        list declarations
 *   POST   /v1/hrms/declarations/:declId/revoke       revoke a declaration
 *   POST   /v1/hrms/declarations/:declId/acknowledge  employee acknowledges
 *
 * CCS (Conduct) Rules: an employee must declare conflicts of interest,
 * property beyond means, outside employment, gifts received, and sign
 * confidentiality undertakings. These are tracked with full audit trail.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsCoiDeclarations } from "./schema.js";
import { hrmsEmployees } from "../employee/schema.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const VIGILANCE_ROLES = [...HR_ROLES, "vigilance_officer"];
const ALL_ROLES = [...HR_ROLES, "employee", "manager"];

const DECL_TYPES = ["coi", "confidentiality", "property", "gift", "outside_employment"] as const;
const idParam = z.object({ id: z.string().uuid() });
const declIdParam = z.object({ declId: z.string().uuid() });

export async function coiDeclarationRoutes(app: FastifyInstance): Promise<void> {
  // File a new declaration
  app.post("/v1/hrms/employees/:id/declarations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      declarationType: z.enum(DECL_TYPES),
      declarationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      details: z.string().min(1).max(8000),
    }).parse(req.body);

    // Verify employee exists in tenant
    const emp = await scopedRead((tx) =>
      tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
        .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, ctx.tenantId)))
        .limit(1),
    );
    if (!emp[0]) throw new HttpError(404, "NOT_FOUND", "employee not found");

    const declId = randomUUID();
    await publishF3Write(ctx, "disciplinary_coi_routes__0", declId, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })

    return reply.code(201).send({
      data: { id: declId, employeeId: id, declarationType: body.declarationType, status: "active" },
    }) as any;
  });

  // List declarations for an employee
  app.get("/v1/hrms/employees/:id/declarations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const query = z.object({
      declarationType: z.enum(DECL_TYPES).optional(),
      status: z.enum(["active", "revoked", "expired", "superseded"]).optional(),
    }).parse(req.query);

    const rows = await scopedRead(async (tx) => {
      let q = tx.select().from(hrmsCoiDeclarations)
        .where(and(
          eq(hrmsCoiDeclarations.tenantId, ctx.tenantId),
          eq(hrmsCoiDeclarations.employeeId, id),
          ...(query.declarationType ? [eq(hrmsCoiDeclarations.declarationType, query.declarationType)] : []),
          ...(query.status ? [eq(hrmsCoiDeclarations.status, query.status)] : []),
        ))
        .orderBy(desc(hrmsCoiDeclarations.declarationDate))
        .limit(100);
      return q;
    });

    return reply.send({ data: rows });
  });

  // Revoke a declaration
  app.post("/v1/hrms/declarations/:declId/revoke", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VIGILANCE_ROLES);
    const { declId } = declIdParam.parse(req.params);
    const body = z.object({
      reason: z.string().min(1).max(2000),
    }).parse(req.body);

    await publishF3Write(ctx, "disciplinary_coi_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })

    return reply.send({ data: { id: declId, status: "revoked" } }) as any;
  });

  // Acknowledge a declaration (employee confirms receipt/understanding)
  app.post("/v1/hrms/declarations/:declId/acknowledge", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { declId } = declIdParam.parse(req.params);

    await publishF3Write(ctx, "disciplinary_coi_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })

    return reply.send({ data: { id: declId, acknowledged: true } }) as any;
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
