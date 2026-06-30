import { ZodError } from "zod";

/**
 * Structural ZodError check. `instanceof ZodError` is unreliable across a
 * pnpm/monorepo when a service's compiled code and this package resolve the
 * zod class through different module realms — the validation error then leaks
 * as a raw 500. Detecting by shape (name + issues[]) is realm-independent and a
 * strict superset of the instanceof check, so it can only ever catch MORE
 * genuine ZodErrors, never fewer.
 */
function isZodError(err: unknown): err is { issues: Array<{ path: (string | number)[]; message: string }> } {
  if (err instanceof ZodError) return true;
  return (
    typeof err === "object" && err !== null &&
    (err as { name?: string }).name === "ZodError" &&
    Array.isArray((err as { issues?: unknown }).issues)
  );
}

export type HttpErrorLike = {
  status: number;
  code: string;
  message: string;
};

export function isHttpError(err: unknown): err is HttpErrorLike {
  if (typeof err !== "object" || err === null) return false;
  // @fastify/rate-limit surfaces statusCode instead of status — normalise so the
  // error handler returns 429 rather than falling through to the generic 500 path.
  if ("statusCode" in err && !("status" in err)) {
    (err as Record<string, unknown>).status = (err as { statusCode: number }).statusCode;
    if (!("code" in err)) (err as Record<string, unknown>).code = "RATE_LIMITED";
  }
  return "status" in err && "code" in err;
}

type FastifyLikeRequest = { id: string; headers: Record<string, unknown>; log: { error: (obj: unknown, msg: string) => void } };
type FastifyLikeReply = { code: (n: number) => { send: (body: unknown) => void } };

/** Uniform Fastify error envelope — use at app or plugin level. */
export function createFastifyErrorHandler(getHttpError?: (err: unknown) => HttpErrorLike | null) {
  return function errorHandler(err: unknown, req: FastifyLikeRequest, reply: FastifyLikeReply): void {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (isZodError(err)) {
      void reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    // Catch JSON parse errors (malformed request body) — Fastify throws SyntaxError
    if (err instanceof SyntaxError && "statusCode" in err) {
      void reply.code(400).send({
        code: "MALFORMED_BODY",
        message: "The request body could not be parsed. Please send valid JSON.",
        correlationId,
        retryable: false,
      });
      return;
    }
    const http = getHttpError?.(err);
    if (http) {
      void reply.code(http.status).send({ code: http.code, message: http.message, correlationId, retryable: false });
      return;
    }
    req.log.error({ err }, "unhandled error");
    void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  };
}
