import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * @fastify/rate-limit (via @civitasone/rate-limit) throws a plain object with statusCode 429 from its
 * onRequest hook. Each workflow module installs its own encapsulated error handler, so every one of them
 * must map that object to 429 + Retry-After; without this it falls through to the generic 500 INTERNAL.
 * Returns the sent reply when `err` is a rate-limit rejection, otherwise undefined.
 */
export function replyIfRateLimited(err: unknown, req: FastifyRequest, reply: FastifyReply): FastifyReply | undefined {
  if (typeof err !== "object" || err === null || (err as { statusCode?: unknown }).statusCode !== 429) return undefined;
  const raw = (err as { retryAfter?: unknown }).retryAfter;
  const retryAfter = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : 60;
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  return reply
    .code(429)
    .header("retry-after", String(retryAfter))
    .send({ code: "RATE_LIMITED", message: "rate limit exceeded", correlationId, retryable: true, retryAfter });
}
