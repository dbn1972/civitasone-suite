import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * BGV checks (T18), property-returns (T22), mandatory-doc config (T21),
 * policy acknowledgements (T24) CRUD.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsBgvChecks, hrmsPropertyReturns, hrmsMandatoryDocConfigs, hrmsPolicyAcknowledgements } from "./schema.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ADMIN_ROLES = ["hr_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });

export async function bgvPropertyPolicyRoutes(app: FastifyInstance): Promise<void> {
  // ── BGV checks ──
  app.post("/v1/hrms/employees/:id/bgv-checks", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      checkType: z.string().min(1).max(32),
      provider: z.string().max(64).optional(),
    }).parse(req.body);
    const bid = randomUUID();
    await publishF3Write(ctx, "lifecycle_bgv_property_policy_routes__0", bid, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: bid, status: "pending" }) as any;
  });

  app.get("/v1/hrms/employees/:id/bgv-checks", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await scopedRead((tx) => tx.select().from(hrmsBgvChecks)
      .where(and(eq(hrmsBgvChecks.tenantId, ctx.tenantId), eq(hrmsBgvChecks.employeeId, id))));
    return reply.send({ data: rows });
  });

  app.patch("/v1/hrms/bgv-checks/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      status: z.enum(["passed", "failed", "inconclusive"]),
      result: z.string().max(2000).optional(),
    }).parse(req.body);
    await publishF3Write(ctx, "lifecycle_bgv_property_policy_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: body.status }) as any;
  });

  // ── Property returns ──
  app.post("/v1/hrms/employees/:id/property-returns", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ itemDescription: z.string().min(1).max(500) }).parse(req.body);
    const pid = randomUUID();
    await publishF3Write(ctx, "lifecycle_bgv_property_policy_routes__2", pid, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: pid, returnStatus: "pending" }) as any;
  });

  app.get("/v1/hrms/employees/:id/property-returns", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await scopedRead((tx) => tx.select().from(hrmsPropertyReturns)
      .where(and(eq(hrmsPropertyReturns.tenantId, ctx.tenantId), eq(hrmsPropertyReturns.employeeId, id))));
    return reply.send({ data: rows });
  });

  app.patch("/v1/hrms/property-returns/:id/return", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    await publishF3Write(ctx, "lifecycle_bgv_property_policy_routes__3", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, returnStatus: "returned" }) as any;
  });

  // ── Mandatory-doc config ──
  app.post("/v1/hrms/mandatory-doc-configs", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const body = z.object({
      employeeType: z.string().min(1).max(32),
      docType: z.string().min(1).max(64),
      required: z.boolean().default(true),
    }).parse(req.body);
    const mid = randomUUID();
    await publishF3Write(ctx, "lifecycle_bgv_property_policy_routes__4", mid, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: mid }) as any;
  });

  app.get("/v1/hrms/mandatory-doc-configs", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(hrmsMandatoryDocConfigs)
      .where(eq(hrmsMandatoryDocConfigs.tenantId, ctx.tenantId)));
    return reply.send({ data: rows });
  });

  // ── Policy acknowledgements ──
  app.post("/v1/hrms/employees/:id/policy-acknowledgements", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, [...HR_ROLES, "employee"]);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      policyName: z.string().min(1).max(200),
      policyVersion: z.string().max(24).optional(),
    }).parse(req.body);
    const pid = randomUUID();
    await publishF3Write(ctx, "lifecycle_bgv_property_policy_routes__5", pid, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: pid, acknowledged: true }) as any;
  });

  app.get("/v1/hrms/employees/:id/policy-acknowledgements", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await scopedRead((tx) => tx.select().from(hrmsPolicyAcknowledgements)
      .where(and(eq(hrmsPolicyAcknowledgements.tenantId, ctx.tenantId), eq(hrmsPolicyAcknowledgements.employeeId, id))));
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
