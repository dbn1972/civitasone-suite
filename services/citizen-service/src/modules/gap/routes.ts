import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";

const ROLES = ["citizen", "citizen_officer", "citizen_admin", "super_admin"];

/**
 * COMP-002: the routes that used to live here — POST/GET/PATCH
 * /v1/citizen/requests(/:id)(/status), GET /v1/citizen/portal/metrics, and
 * GET/PATCH /v1/citizen/profiles/:id — were fabricated-success stubs (202/200
 * with no persistence). They are now real: requests are handled by
 * modules/requests/routes.ts (backed by requests.citizen_requests), and the
 * profile routes by modules/portal/routes.ts (backed by the pre-existing real
 * portal.citizen_profiles table). See app.ts registration order.
 *
 * What remains here — alerts/notices/surveys — has no genuine backing store
 * anywhere in this service or a reachable one (checked notification-service's
 * `alerts` module: that is operational alert-rule/event tooling, not a
 * citizen-facing public-notice board, and is a different service's database
 * regardless). Building that store is out of scope for COMP-002, so these
 * honestly report "not implemented" (501) instead of a fabricated empty list
 * that would be indistinguishable from a genuinely-queried empty result.
 * fetchJson() in the web app already treats a non-2xx as source:"error" and
 * renders an honest empty/error state — see apps/web/src/app/_data/apiClient.ts.
 */
export async function citizenGapRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/citizen/alerts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.code(501).send({
      code: "NOT_IMPLEMENTED",
      message: "citizen alerts has no backing store yet",
      correlationId: (req.headers["x-correlation-id"] as string) ?? req.id,
      retryable: false,
    });
  });

  app.get("/v1/citizen/notices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.code(501).send({
      code: "NOT_IMPLEMENTED",
      message: "citizen notices has no backing store yet",
      correlationId: (req.headers["x-correlation-id"] as string) ?? req.id,
      retryable: false,
    });
  });

  app.get("/v1/citizen/surveys", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.code(501).send({
      code: "NOT_IMPLEMENTED",
      message: "citizen surveys has no backing store yet",
      correlationId: (req.headers["x-correlation-id"] as string) ?? req.id,
      retryable: false,
    });
  });
}
