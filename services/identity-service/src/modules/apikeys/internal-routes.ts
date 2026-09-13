import type { FastifyInstance, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { assertGatewayRequest } from "@civitasone/auth/plugin";
import { AuthContextError } from "@civitasone/auth/context";
import { HttpError } from "../../shared/context.js";
import { verifyApiKeyBody } from "./validators.js";
import * as commands from "./commands.js";

/**
 * SEC-024 — internal, gateway-only api-key verification.
 *
 * Distinct from POST /identity/api-keys/verify (routes.ts), which is an
 * ADMIN-role, ctx.tenantId-scoped utility for a human admin to test a key
 * within their OWN tenant (and correctly REJECTS a key belonging to another
 * tenant -- see the cross-tenant check there). This route serves a different
 * caller entirely: the gateway's apiKeyPreHandler (gateway-service's
 * api-key-auth.ts), which receives a raw x-api-key from an arbitrary,
 * not-yet-authenticated external caller and needs to DISCOVER which tenant
 * it belongs to -- there is no ctx.tenantId to scope or cross-check against
 * yet. Reusing the admin route for this would either 401 (no bearer token,
 * no x-tenant-id to elevate with) or, worse, incorrectly reject every real
 * key as "cross-tenant" if the gateway asserted any tenant header at all,
 * since it can never match the key's actual tenant in advance.
 *
 * Gated by assertGatewayRequest (x-gateway-request + x-internal-secret) --
 * the same mechanism api-key-auth.ts's fetch call already (partially) spoke
 * before this fix, just with no matching route on this side (that was
 * SEC-024 itself: a 404, since nothing was registered at this path at all).
 * assertGatewayRequest already existed in packages/auth/src/plugin.ts,
 * purpose-built for exactly this "gateway calls a downstream service
 * directly, bypassing normal per-user auth" scenario, but had zero real call
 * sites anywhere in the codebase before this route.
 *
 * Registered with config:{public:true} so the global authPlugin onRequest
 * hook (packages/auth/src/plugin.ts) does not itself demand a bearer token
 * or x-internal+x-service-secret+x-tenant-id first (this caller has none of
 * those -- it has x-gateway-request+x-internal-secret instead, a different
 * mechanism). assertGatewayRequest, run as this route's own preHandler, is
 * the real gate. Mirrors the same public-route-with-its-own-preHandler-auth
 * shape already used elsewhere for a non-ctx caller, e.g.
 * visitor-service/src/modules/device-registry/routes.ts's deviceAuth.
 */
async function assertGatewayPreHandler(req: FastifyRequest): Promise<void> {
  try {
    assertGatewayRequest(req);
  } catch (err) {
    // assertGatewayRequest throws the shared AuthContextError (status/code/message),
    // not this service's local HttpError -- convert it the same way
    // shared/context.ts's resolveContext() already does for the same reason,
    // so this route's own setErrorHandler (which only recognizes HttpError)
    // renders the intended 403 instead of falling through to a bare 500.
    if (err instanceof AuthContextError) throw new HttpError(err.status, err.code, err.message);
    throw err;
  }
}

export async function apiKeyInternalRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/internal/apikeys/verify",
    { preHandler: [assertGatewayPreHandler], config: { public: true } },
    async (req, reply) => {
      const body = verifyApiKeyBody.parse(req.body);
      const result = await commands.verifyApiKey(body.key, body.requiredScope);
      return reply.send(result);
    },
  );

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
