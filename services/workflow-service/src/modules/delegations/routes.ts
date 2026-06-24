import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";

const ROLES = ["workflow_user", "workflow_admin", "super_admin", "tenant_admin"];

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

    const record = await repo.create({
      tenantId: ctx.tenantId,
      delegatorId: ctx.actorId,
      delegateId: body.delegateId,
      fromDate: body.fromDate,
      toDate: body.toDate ?? null,
      reason: body.reason ?? null,
    });
    return reply.code(201).send({ data: record });
  });

  app.get("/v1/workflow/delegations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data: rows, total });
  });

  app.delete("/v1/workflow/delegations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const record = await repo.revoke(id, ctx.tenantId);
    if (!record) throw new HttpError(404, "NOT_FOUND", "delegation not found");
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
