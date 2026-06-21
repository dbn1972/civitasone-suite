import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { APIKeySummaryListSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { listQuerySchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as queries from "./queries.js";

const ADMIN_ROLES = ["platform_admin", "super_admin", "tenant_admin"];

export async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/api-keys", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, APIKeySummaryListSchema, await queries.listApiKeys(ctx.tenantId, q.limit));
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
