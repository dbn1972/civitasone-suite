import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";

const READER_ROLES = ["finance_officer", "finance_admin", "super_admin", "audit_officer"];

export async function mastersRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/pao", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = await repo.listPao(ctx.tenantId);
    return reply.send({
      data: rows.map((r) => ({ id: r.id, paoCode: r.paoCode, name: r.name, ministry: r.ministry, isActive: r.isActive })),
    });
  });

  app.get("/v1/finance/ddo", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = await repo.listDdo(ctx.tenantId);
    return reply.send({
      data: rows.map((r) => ({ id: r.id, ddoCode: r.ddoCode, name: r.name, paoCode: r.paoCode, isActive: r.isActive })),
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
