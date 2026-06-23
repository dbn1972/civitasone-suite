import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const ROLES = ["workflow_user", "workflow_admin", "super_admin", "tenant_admin"];

interface Delegation {
  id: string;
  tenantId: string;
  delegatorId: string;
  delegateId: string;
  fromDate: string;
  toDate: string | null;
  reason: string | null;
  isActive: boolean;
  createdAt: string;
}

const store: Delegation[] = [];

export async function delegationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/workflow/delegations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = z.object({
      delegateId: z.string().uuid(),
      fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      reason: z.string().max(256).optional(),
    }).parse(req.body);

    const record: Delegation = {
      id: crypto.randomUUID(),
      tenantId: ctx.tenantId,
      delegatorId: ctx.actorId,
      delegateId: body.delegateId,
      fromDate: body.fromDate,
      toDate: body.toDate ?? null,
      reason: body.reason ?? null,
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    store.push(record);
    return reply.code(201).send({ data: record });
  });

  app.get("/v1/workflow/delegations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const rows = store
      .filter((d) => d.tenantId === ctx.tenantId)
      .slice(q.offset, q.offset + q.limit);
    return reply.send({ data: rows, total: store.filter((d) => d.tenantId === ctx.tenantId).length });
  });

  app.delete("/v1/workflow/delegations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const record = store.find((d) => d.id === id && d.tenantId === ctx.tenantId);
    if (!record) throw new HttpError(404, "NOT_FOUND", "delegation not found");
    record.isActive = false;
    return reply.send({ data: record });
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
