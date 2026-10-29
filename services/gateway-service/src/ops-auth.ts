/**
 * Access control for the gateway's own operational / diagnostic endpoints.
 *
 * UAT W6-G (w6h-harness): `GET /ops/breakers` answered 200 to an anonymous caller, listing every
 * upstream route name the gateway has proxied to and the state of its circuit breaker (which
 * upstreams are currently failing). `GET /metrics/prom` (full prom-client registry: process,
 * heap, event-loop and per-route request / status / latency series) and `GET /metrics/latency` had
 * the same hole. None of them sit under /api/*, so the proxy's bearer pre-check never applied, and
 * jwtEdgeVerify only rejects a token that is PRESENT and invalid; it never demands one.
 *
 * Accepted callers, in order:
 *   1. a service presenting a valid x-internal-secret (timing-safe compare against
 *      INTERNAL_SERVICE_SECRET), the same credential /internal/config and
 *      /internal/module-cache/invalidate already require;
 *   2. a user whose bearer token jwtEdgeVerify VERIFIED (req.jwtPayload is set only on a successful
 *      verify: never in "off" mode and never after a failed verify in "audit" mode) and which carries
 *      the platform_admin role.
 * Anything else: 401 when no credential was presented at all, 403 otherwise. /health, /ready and the
 * centrally guarded /metrics (@civitasone/observability) are not affected.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import type { CivitasJwtPayload } from "@civitasone/auth";

export const OPS_ROLES: readonly string[] = ["platform_admin"];

/** Verify the internal service-to-service secret (timing-safe). */
export function verifyInternalSecret(req: FastifyRequest): boolean {
  const secret = req.headers["x-internal-secret"];
  const expected = process.env.INTERNAL_SERVICE_SECRET;
  if (!expected || expected.length === 0) return false;
  if (typeof secret !== "string" || secret.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(secret, "utf8"), Buffer.from(expected, "utf8"));
}

/** preHandler for ops/diagnostic routes: internal secret or verified platform_admin JWT. */
export async function requireOpsCaller(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (verifyInternalSecret(req)) return;

  const payload = (req as FastifyRequest & { jwtPayload?: CivitasJwtPayload }).jwtPayload;
  const roles = Array.isArray(payload?.roles) ? payload.roles : [];
  if (payload && roles.some((r) => OPS_ROLES.includes(r))) return;

  const auth = req.headers["authorization"];
  const presented =
    (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) ||
    req.headers["x-internal-secret"] !== undefined;
  if (!presented) {
    return reply
      .code(401)
      .send({ code: "UNAUTHENTICATED", message: "ops endpoint requires authentication" });
  }
  return reply.code(403).send({ code: "FORBIDDEN", message: "ops endpoint access denied" });
}
