import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { HttpError } from "../../shared/context.js";

/** Roles allowed on every bulk-scan endpoint (same constants as the other document-service route groups). */
export const BULK_SCAN_ROLES = ["document_admin", "super_admin"];
export const SUPER_ADMIN_ROLES = ["super_admin"];

/** Per-plugin error handler (matches modules/files/routes.ts). */
export function installBulkScanErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    // @fastify/rate-limit (via @civitasone/rate-limit) throws the standard 429 body built by errorResponseBuilder
    const rl = err as { statusCode?: number; error?: string; message?: string; retryAfter?: number };
    if (rl.statusCode === 429 && rl.error === "TOO_MANY_REQUESTS") {
      if (rl.retryAfter !== undefined) void reply.header("retry-after", String(rl.retryAfter));
      return reply.code(429).send({ statusCode: 429, error: "TOO_MANY_REQUESTS", message: rl.message, retryAfter: rl.retryAfter });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    if (err instanceof Error && err.name === "StorageNotConfiguredError") {
      return reply.code(503).send({ code: "STORAGE_UNAVAILABLE", message: "object storage is not configured", correlationId, retryable: true });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
