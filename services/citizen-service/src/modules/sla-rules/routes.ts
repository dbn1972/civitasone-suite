import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const CITIZEN_ADMIN_ROLES = ["citizen_admin", "super_admin", "admin", "tenant_admin"];

interface SlaRule {
  id: string;
  tenantId: string;
  priority: string;
  escalationHours: number;
  escalateTo: string;
  isActive: boolean;
  createdAt: string;
}

const store: SlaRule[] = [];

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

    const record: SlaRule = {
      id: crypto.randomUUID(),
      tenantId: ctx.tenantId,
      priority: body.priority,
      escalationHours: body.escalationHours,
      escalateTo: body.escalateTo,
      isActive: body.isActive,
      createdAt: new Date().toISOString(),
    };
    store.push(record);
    return reply.code(201).send({ data: record });
  });

  app.get("/v1/citizen/sla-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ADMIN_ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const rows = store.filter((r) => r.tenantId === ctx.tenantId && r.isActive);
    return reply.send({ data: rows.slice(q.offset, q.offset + q.limit), total: rows.length });
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
