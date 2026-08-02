/**
 * Standard API envelope + error handler for the routes added by the
 * world-class-gap sprint (WC-010, WC-009, CR-MOB-01, ORG-07, DM-002).
 *
 * The platform API standard is:
 *   list   → { data, meta: { page, pageSize, total } }
 *   single → { data }
 *   error  → { error: { code, message, details?, correlationId } }
 *
 * Older admin-service modules emit a FLAT error body (`{ code, message,
 * correlationId }`). Those are left untouched — changing them would break their
 * existing tests and any client already parsing them. Fastify's per-plugin
 * `setErrorHandler` is encapsulated, so the new route plugins install this
 * handler for themselves only and the two shapes coexist safely.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError, type z } from "zod";
import { HttpError } from "./context.js";

export interface ListMeta {
  page: number;
  pageSize: number;
  total: number;
}

export function listEnvelope<T>(data: T[], meta: ListMeta): { data: T[]; meta: ListMeta } {
  return { data, meta };
}

export function singleEnvelope<T>(data: T): { data: T } {
  return { data };
}

function correlationOf(req: FastifyRequest): string {
  const header = req.headers["x-correlation-id"];
  return typeof header === "string" && header.length > 0 ? header : req.id;
}

/**
 * Parse `data` with `schema`, converting a validation failure into a 400
 * HttpError carrying per-field details. Kept separate from the error handler so
 * domain code can validate without a request in scope.
 *
 * `Input` is deliberately widened (`z.ZodType<T, ZodTypeDef, never>` would
 * reject schemas that use `.default(...)`, whose input type is optional while
 * their output type is required — see feature-flags/routes.ts for the same note).
 */
export function parseOrThrow<T>(
  schema: { safeParse: (d: unknown) => z.SafeParseReturnType<unknown, T> },
  data: unknown,
): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const details: Record<string, string> = {};
  for (const issue of result.error.issues) {
    details[issue.path.join(".") || "_"] = issue.message;
  }
  throw new HttpError(400, "VALIDATION_FAILED", "invalid request").withDetails(details);
}

/**
 * Install the standard error handler on a route plugin. Maps ZodError → 400 and
 * HttpError → its own status; anything else is logged and returned as 500
 * without leaking driver-level detail to the client.
 */
export function registerEnvelopeErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply: FastifyReply) => {
    const correlationId = correlationOf(req);
    if (err instanceof ZodError) {
      const details: Record<string, string> = {};
      for (const issue of err.issues) details[issue.path.join(".") || "_"] = issue.message;
      return reply.code(400).send({
        error: { code: "VALIDATION_FAILED", message: "invalid request", details, correlationId },
      });
    }
    if (err instanceof HttpError) {
      const details = err.details;
      return reply.code(err.status).send({
        error: {
          code: err.code,
          message: err.message,
          ...(details !== undefined ? { details } : {}),
          correlationId,
        },
      });
    }
    // Fastify's own errors (bad JSON body, unsupported media type) carry a
    // statusCode; honour it rather than masking a client error as a 500.
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({
        error: { code: "BAD_REQUEST", message: err.message, correlationId },
      });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({
      error: { code: "INTERNAL", message: "internal error", correlationId },
    });
  });
}
