import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as queries from "./queries.js";

const ROLES = ["workflow_user", "workflow_admin", "super_admin", "tenant_admin"];

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().min(0).default(0),
}).partial();

/**
 * P0-3 — read-only workflow analytics / SLA reporting endpoints. Tenant-scoped
 * and authorized to any workflow role (read-only aggregates, no mutation).
 */
export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/workflow/analytics/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    listQuerySchema.parse(req.query);
    return reply.send({ data: await queries.summary(ctx.tenantId) });
  });

  app.get("/v1/workflow/analytics/bottlenecks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    listQuerySchema.parse(req.query);
    return reply.send({ data: await queries.bottlenecks(ctx.tenantId) });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
