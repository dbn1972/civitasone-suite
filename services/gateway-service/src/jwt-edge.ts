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
import { canonicalisePath, BAD_PATH_RESPONSE } from "./path-guard.js";

const log = pino({ name: "gateway-jwt-edge" });

/**
 * Routes that skip JWT edge verification (login, refresh, public install, careers apply,
 * LM-002 public lead capture). Must stay in step with PUBLIC_PREFIXES in app.ts —
 * a path public there but not here would be 401'd by this hook instead.
 */
const PUBLIC_PREFIXES = [
  "/api/identity",
  "/api/v1/install",
  "/api/v1/careers",
  "/api/v1/crm/public",
  // Must stay in sync with PUBLIC_PREFIXES in app.ts — see the comment there
  // for why (MSME self-signup, deep-verification, 2026-08-27).
  "/api/v1/tenant/msme-onboard",
];

/**
 * Fastify preHandler — verifies the JWT signature at the gateway edge.
 * Attach to the proxy routes via app.addHook("preHandler", jwtEdgeVerify).
 */
export async function jwtEdgeVerify(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  /**
   * Canonicalise FIRST — before the mode check, and before the public-prefix test.
   *
   * This hook's `isPublic` and proxyHandler's are two independent computations over the
   * same idea, which is how `POST /api/v1/crm/public/%2e%2e/contacts` came to skip both
   * the bearer check and this verification while `fetch` collapsed the `%2e%2e` into a
   * real `..` and landed on an authenticated CRM route. The header above already says
   * these two must stay in step; sharing `canonicalisePath` is what actually makes that
   * true rather than aspirational.
   *
   * Ahead of the `mode === "off"` early return on purpose: the guard is not part of JWT
   * verification, it is a statement about the request being well-formed at all, and a
   * deployment running with edge verification disabled must not lose it.
   */
  const canonical = canonicalisePath(req.url);
  if (!canonical.ok) {
    log.warn(
      { correlationId: req.id, reason: canonical.reason },
      "rejected malformed request path",
    );
    return reply
      .code(400)
      .send({ ...BAD_PATH_RESPONSE, correlationId: req.id });
  }
  const pathname = canonical.pathname;

  const mode = configValue("jwtEdgeVerify");
  if (mode === "off") return;

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
    (req as FastifyRequest & { jwtPayload?: CivitasJwtPayload }).jwtPayload =
      payload;
    // SEC-P0: the verified token's tid claim is AUTHORITATIVE. Always overwrite any
    // client-supplied x-tenant-id so a logged-in user cannot forge a victim tenant id
    // in the header (downstream services source the RLS GUC from x-tenant-id).
    //
    // This MUST run unconditionally, including when tid is absent. A token can verify
    // (valid signature/issuer) yet still carry no tid claim — a real, previously-seen
    // condition on this platform (a Keycloak account missing the tenant-mapper
    // attribute). The old `if (payload.tid)` guard skipped the overwrite in exactly
    // that case, leaving any client-supplied x-tenant-id header completely untouched.
    // createTenantTxHook (used by 64 of the platform's services, including every
    // CEP-cluster service) sources the RLS GUC straight from that header, so an
    // authenticated user with such a token could set x-tenant-id to an arbitrary
    // victim tenant and have it trusted downstream — a cross-tenant RLS bypass.
    // Deleting the header when tid is missing makes downstream services see no
    // tenant at all instead, which FORCE RLS denies by default (fail closed).
    const headers = req.headers as Record<string, string | undefined>;
    if (payload.tid) {
      headers["x-tenant-id"] = payload.tid;
    } else {
      delete headers["x-tenant-id"];
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "token verification failed";

    if (mode === "audit") {
      // Shadow mode: log but allow through (useful during rollout to detect breakage).
      log.warn(
        { correlationId: req.id, err: message, url: pathname },
        "JWT edge verify FAILED (audit mode — allowed through)",
      );
      return;
    }

    // Enforce mode: reject with 401.
    log.info(
      { correlationId: req.id, err: message, url: pathname },
      "JWT edge reject",
    );
    return reply.code(401).send({
      code: "TOKEN_INVALID",
      message: "Token verification failed at gateway edge",
      correlationId: req.id,
    });
  }
}
