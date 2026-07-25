/**
 * Integration module routes — external HR system sync configuration and status.
 * Provides endpoints for managing integrations with eHRMS, PFMS payroll feed,
 * DigiLocker verification, and biometric device sync.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { sqlPool } from "../../shared/db.js";

const ADMIN_ROLES = ["hr_admin", "super_admin", "platform_admin"];

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  // List configured integrations for a tenant
  app.get("/v1/hrms/integrations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { rows } = await sqlPool.query(
      `SELECT id, name, type, status, last_sync_at, config
       FROM employee.integrations
       WHERE tenant_id = $1 ORDER BY name`,
      [ctx.tenantId],
    );
    return reply.send({ data: rows });
  });

  // Create/register a new integration
  app.post("/v1/hrms/integrations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = z.object({
      name: z.string().min(1).max(128),
      type: z.enum(["ehrms", "pfms_payroll", "digilocker", "biometric", "custom"]),
      config: z.record(z.unknown()).default({}),
    }).parse(req.body);

    const id = randomUUID();
    await sqlPool.query(
      `INSERT INTO employee.integrations (id, tenant_id, name, type, config, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'active', $6)`,
      [id, ctx.tenantId, body.name, body.type, JSON.stringify(body.config), ctx.actorId],
    );
    return reply.code(201).send({ data: { id, ...body, status: "active" } });
  });

  // Trigger a sync for a specific integration
  app.post("/v1/hrms/integrations/:id/sync", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await sqlPool.query(
      `SELECT id, type, status FROM employee.integrations WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    if (!rows[0]) throw new HttpError(404, "NOT_FOUND", "Integration not found");
    if (rows[0].status !== "active") throw new HttpError(422, "INACTIVE", "Integration is not active");

    // Record sync attempt
    await sqlPool.query(
      `UPDATE employee.integrations SET last_sync_at = NOW() WHERE id = $1`,
      [id],
    );
    return reply.code(202).send({ data: { id, syncStatus: "initiated", initiatedAt: new Date().toISOString() } });
  });

  // Get sync history for an integration
  app.get("/v1/hrms/integrations/:id/history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await sqlPool.query(
      `SELECT id, status, records_synced, errors, started_at, completed_at
       FROM employee.integration_sync_log
       WHERE integration_id = $1 AND tenant_id = $2
       ORDER BY started_at DESC LIMIT 50`,
      [id, ctx.tenantId],
    );
    return reply.send({ data: rows });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
