/**
 * Edge JWT verification — validate token signatures at the gateway before proxying.
 *
 * This adds defense-in-depth: invalid/expired/forged tokens are rejected at the
 * edge rather than consuming upstream resources. Each service still re-validates
 * (the verified claims are NOT passed as trusted headers), but this pre-filter
 * eliminates:
 *  - Expired tokens hitting all 33 services
 *  - Tokens signed by a revoked key (JWKS cache is shared)
 *  - Malformed JWTs that would waste upstream parse cycles at 1000 TPS
 *
 * Env vars:
 *   GATEWAY_JWT_EDGE_VERIFY — "true" (default) | "audit" | "off"
 *     true  = reject invalid tokens (401)
 *     audit = log invalid tokens but allow through (shadow mode for rollout)
 *     off   = skip entirely (backward-compatible, same as today)
 *
 *   KEYCLOAK_URL, KEYCLOAK_REALM, JWT_ALGORITHM, JWT_SECRET — from @civitasone/auth
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyJwt, type CivitasJwtPayload } from "@civitasone/auth";
import { pino } from "pino";
import { configValue } from "./runtime-config.js";

const log = pino({ name: "gateway-jwt-edge" });

/** Routes that skip JWT edge verification (login, refresh, public install). */
const PUBLIC_PREFIXES = ["/api/identity", "/api/v1/install", "/api/v1/careers"];

/**
 * Fastify preHandler — verifies the JWT signature at the gateway edge.
 * Attach to the proxy routes via app.addHook("preHandler", jwtEdgeVerify).
 */
export async function jwtEdgeVerify(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const mode = configValue("jwtEdgeVerify");
  if (mode === "off") return;

  const pathname = req.url.split("?")[0] ?? "/";
  const isPublic = PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  if (isPublic) return;

  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    // No token at all — the existing 401 guard in proxyHandler handles this.
    // We don't duplicate that logic here; just skip verification.
    return;
  }

  const token = authHeader.slice(7); // strip "Bearer "

  try {
    const payload = await verifyJwt(token);
    // Attach the verified tenant/actor to the request for downstream guards
    // (module-guard, policy-check) that need tenant context without re-verifying.
    (req as FastifyRequest & { jwtPayload?: CivitasJwtPayload }).jwtPayload = payload;
    // SEC-P0: the verified token's tid claim is AUTHORITATIVE. Always overwrite any
    // client-supplied x-tenant-id so a logged-in user cannot forge a victim tenant id
    // in the header (downstream services source the RLS GUC from x-tenant-id).
    if (payload.tid) {
      (req.headers as Record<string, string>)["x-tenant-id"] = payload.tid;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "token verification failed";

    if (mode === "audit") {
      // Shadow mode: log but allow through (useful during rollout to detect breakage).
      log.warn(
        { correlationId: req.id, err: message, url: pathname },
        "JWT edge verify FAILED (audit mode — allowed through)",
      );
      return;
    }

    // Enforce mode: reject with 401.
    log.info({ correlationId: req.id, err: message, url: pathname }, "JWT edge reject");
    return reply.code(401).send({
      code: "TOKEN_INVALID",
      message: "Token verification failed at gateway edge",
      correlationId: req.id,
    });
  }
}
