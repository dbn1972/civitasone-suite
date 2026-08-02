/**
 * Standard-envelope error handler for routes added in this sprint.
 *
 * The suite's documented error contract is
 *   { error: { code, message, details?, correlationId } }
 *
 * The pre-existing metadata-service routes emit a FLAT `{ code, message,
 * correlationId }` body (see shared/errors.ts). Changing those would break every
 * existing caller and test, so this handler is used only by the new forms and
 * public-form plugins, which have no callers yet and therefore can be correct
 * from the start. Aligning the legacy routes is a separate, breaking change.
 *
 * Fastify plugin encapsulation means `setErrorHandler` inside a plugin applies to
 * that plugin's routes only, so the two shapes coexist without interfering.
 *
 * Nothing about the request body ever reaches the response: ZodError issues are
 * summarised to paths, never values, because the public endpoint must not
 * reflect submitted content.
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { HttpError } from "./context.js";

/** HttpError carrying structured, already-sanitised details. */
export class DetailedHttpError extends HttpError {
  constructor(status: number, code: string, message: string, public readonly details: Record<string, unknown>) {
    super(status, code, message);
  }
}

export function registerStandardErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string | undefined) ?? req.id;

    if (err instanceof ZodError) {
      // Only the failing paths and issue codes — never the offending values.
      const details = { fields: err.issues.map((i) => ({ path: i.path.join("."), code: i.code })) };
      return reply
        .code(400)
        .send({ error: { code: "VALIDATION_FAILED", message: "invalid request", details, correlationId } });
    }

    if (err instanceof DetailedHttpError) {
      return reply
        .code(err.status)
        .send({ error: { code: err.code, message: err.message, details: err.details, correlationId } });
    }

    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, correlationId } });
    }

    // Fastify raises this when the request body exceeds the route's bodyLimit.
    if ((err as { statusCode?: number }).statusCode === 413) {
      return reply
        .code(413)
        .send({ error: { code: "PAYLOAD_TOO_LARGE", message: "request body exceeds the permitted size", correlationId } });
    }

    if ((err as { statusCode?: number }).statusCode === 400) {
      // Malformed JSON and similar parse failures — do not echo the body back.
      return reply
        .code(400)
        .send({ error: { code: "BAD_REQUEST", message: "request could not be parsed", correlationId } });
    }

    if ((err as { code?: string }).code === "23505") {
      return reply
        .code(409)
        .send({ error: { code: "CONFLICT", message: "resource already exists", correlationId } });
    }

    req.log.error({ err }, "unhandled");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "internal error", correlationId } });
  });
}
