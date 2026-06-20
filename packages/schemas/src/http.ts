import { ZodError } from "zod";

export type HttpErrorLike = {
  status: number;
  code: string;
  message: string;
};

export function isHttpError(err: unknown): err is HttpErrorLike {
  return typeof err === "object" && err !== null && "status" in err && "code" in err;
}

type FastifyLikeRequest = { id: string; headers: Record<string, unknown>; log: { error: (obj: unknown, msg: string) => void } };
type FastifyLikeReply = { code: (n: number) => { send: (body: unknown) => void } };

/** Uniform Fastify error envelope — use at app or plugin level. */
export function createFastifyErrorHandler(getHttpError?: (err: unknown) => HttpErrorLike | null) {
  return function errorHandler(err: unknown, req: FastifyLikeRequest, reply: FastifyLikeReply): void {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      void reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
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
