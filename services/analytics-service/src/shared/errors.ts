/** Shared Fastify error handler — maps zod, HttpError and RegistryError to the
 * canonical CivitasOne error envelope. Registered per route plugin. */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { HttpError } from "./context.js";
import { RegistryError } from "../modules/registry/registry.js";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof RegistryError) {
      // a non-whitelisted metric/dimension/filter — caller error, never a 500.
      return reply.code(400).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
