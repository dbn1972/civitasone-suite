import type { FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { resolveServiceContext, AuthContextError } from "@civitasone/auth/context";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resolveContext(req: FastifyRequest): RequestContext {
  try {
    const ctx = resolveServiceContext(req);
    if (!ctx.tenantId || !UUID_RE.test(ctx.tenantId)) {
      throw new HttpError(401, "UNAUTHENTICATED", "missing or malformed tenant context");
    }
    return ctx;
  } catch (err) {
    if (err instanceof AuthContextError) {
      throw new HttpError(err.status, err.code, err.message);
    }
    throw err;
  }
}

export function requireRole(ctx: RequestContext, roles: string[]): void {
  if (!hasAnyRole(ctx, roles)) {
    throw new HttpError(403, "FORBIDDEN", `requires one of: ${roles.join(", ")}`);
  }
}

/**
 * BUG FIX: shared Fastify error handler, factored out of ~25 near-identical
 * per-module `app.setErrorHandler` blocks that each only special-cased
 * ZodError/HttpError and flattened everything else — including errors that
 * already carry a correct, more specific status — into a blanket
 * `500 {code:"INTERNAL", retryable:true}`. Two concrete cases this hid:
 *
 *  - A malformed-JSON request body: Fastify's own body parser throws with a
 *    real `.statusCode = 400`, which got discarded. Reporting `retryable:true`
 *    on a 400 is actively wrong — the exact same malformed body can never
 *    succeed on retry, so a well-behaved client following that hint retries
 *    forever.
 *  - A rate-limit rejection: @civitasone/rate-limit's errorResponseBuilder
 *    (packages/rate-limit/src/index.ts) throws a plain
 *    `{statusCode: 429, error, message, retryAfter}` object (NOT an Error
 *    instance — @fastify/rate-limit's onRequest hook does
 *    `throw errorResponseBuilder(...)`), which also isn't `instanceof
 *    ZodError`/`HttpError` and fell into the same 500 bucket, discarding the
 *    retryAfter hint a client needs to back off correctly. Unlike a plain
 *    400, a 429 genuinely IS retryable — just not immediately.
 *
 * The ZodError check also accepts a duck-typed match (`name === "ZodError"`),
 * matching the extra defensiveness two of the original per-module handlers
 * (anomaly/routes.ts, resolution-intake/routes.ts) already had — multiple zod
 * instances in the dependency tree can make `instanceof` unreliable.
 */
export function financeErrorHandler(err: unknown, req: FastifyRequest, reply: FastifyReply) {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  const isZodError = err instanceof ZodError
    || (!!err && typeof err === "object" && "name" in err && (err as { name: unknown }).name === "ZodError");
  if (isZodError) {
    const zodErr = err as unknown as ZodError;
    return reply.code(400).send({
      code: "VALIDATION_FAILED",
      message: "invalid request",
      correlationId,
      retryable: false,
      fieldErrors: zodErr.issues?.map((i) => ({ field: i.path.join("."), message: i.message })) ?? [],
    });
  }
  if (err instanceof HttpError) {
    return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
  }
  // Preserve a real status code Fastify/a plugin already attached instead of
  // flattening every other error shape to 500. Only trusted for 4xx — a
  // framework/plugin error claiming a 5xx status still falls through to the
  // generic internal-error branch below, unchanged from before.
  const known = err as { statusCode?: unknown; code?: unknown; error?: unknown; message?: unknown; retryAfter?: unknown };
  if (typeof known?.statusCode === "number" && known.statusCode >= 400 && known.statusCode < 500) {
    const status = known.statusCode;
    const isRateLimited = status === 429;
    req.log.warn({ err }, "client error");
    return reply.code(status).send({
      code: typeof known.code === "string" ? known.code : (typeof known.error === "string" ? known.error : "REQUEST_ERROR"),
      message: typeof known.message === "string" ? known.message : "request error",
      correlationId,
      // A 429 is retryable after the hinted delay; every other 4xx we land
      // here for (malformed body, oversized payload, etc.) is not — retrying
      // the identical request cannot succeed.
      retryable: isRateLimited,
      ...(typeof known.retryAfter === "number" ? { retryAfter: known.retryAfter } : {}),
    });
  }
  req.log.error({ err }, "unhandled error");
  return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
