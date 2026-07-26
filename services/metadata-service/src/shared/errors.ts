import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { HttpError } from "./context.js";

/** Uniform error handler shared by every route plugin in this service. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    }
    // Unique-violation from PostgreSQL → 409 Conflict.
    if ((err as { code?: string }).code === "23505") {
      return reply.code(409).send({ code: "CONFLICT", message: "resource already exists", correlationId: cid });
    }
    req.log.error({ err }, "unhandled");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
