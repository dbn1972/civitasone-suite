import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";

const VIEW_ROLES = [
  "workflow_user", "workflow_admin", "super_admin", "tenant_admin",
  "hr_admin", "manager", "payroll_admin", "procurement_admin",
];
const AUDIT_ROLES = ["workflow_admin", "super_admin", "tenant_admin", "platform_admin"];

export async function historyRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/workflow/history/instance/:instanceId
  // Returns the ordered transition log for a workflow instance.
  app.get("/v1/workflow/history/instance/:instanceId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VIEW_ROLES);
    const { instanceId } = z.object({ instanceId: z.string().uuid() }).parse(req.params);
    const rows = await repo.listForInstance(instanceId, ctx.tenantId);
    return reply.code(200).send({ data: rows });
  });

  // GET /v1/workflow/history/audit
  // Tenant-wide audit export (date-ranged, keyset-cursor-paginated).
  // Query params: from (ISO), to (ISO), limit, afterCreatedAt, afterId
  app.get("/v1/workflow/history/audit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const q = z.object({
      from: z.string().datetime({ offset: true }),
      to: z.string().datetime({ offset: true }),
      limit: z.coerce.number().int().min(1).max(1000).default(100),
      afterCreatedAt: z.string().datetime({ offset: true }).optional(),
      afterId: z.string().uuid().optional(),
    }).parse(req.query);
    const rows = await repo.exportForTenant(
      ctx.tenantId,
      new Date(q.from),
      new Date(q.to),
      q.limit,
      q.afterCreatedAt ? new Date(q.afterCreatedAt) : null,
      q.afterId ?? null,
    );
    return reply.code(200).send({ data: rows, nextCursor: rows.length === q.limit ? rows[rows.length - 1]?.id : null });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
