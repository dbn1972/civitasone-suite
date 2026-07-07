import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as queries from "./queries.js";

const READER_ROLES = ["audit_officer", "audit_admin", "super_admin", "vigilance_officer"];

export async function investigationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/audit/investigations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    return reply.send(await queries.listInvestigations(ctx.tenantId, q.limit));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
