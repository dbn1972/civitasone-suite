import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";

const CITIZEN_ADMIN_ROLES = ["citizen_admin", "super_admin", "admin", "tenant_admin"];

const createBody = z.object({
  priority: z.string().min(1).max(16),
  escalationHours: z.number().int().min(1).max(720),
  escalateTo: z.string().min(1).max(64),
  isActive: z.boolean().default(true),
});

export async function slaRulesRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/citizen/sla-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ADMIN_ROLES);
    const body = createBody.parse(req.body);
    // P1-1: persisted (was an in-memory store) — survives restart, feeds the SLA sweep.
    const record = await repo.upsertRule({
      tenantId: ctx.tenantId,
      priority: body.priority,
      escalationHours: body.escalationHours,
      escalateTo: body.escalateTo,
      isActive: body.isActive,
    });
    return reply.code(201).send({ data: record });
  });

  app.get("/v1/citizen/sla-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ADMIN_ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const [rows, total] = await Promise.all([
      repo.listActiveRules(ctx.tenantId, q.limit, q.offset),
      repo.countActiveRules(ctx.tenantId),
    ]);
    return reply.send({ data: rows, total });
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
