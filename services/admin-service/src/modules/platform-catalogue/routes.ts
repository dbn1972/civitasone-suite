/**
 * COMP-020: the superadmin console read endpoints behind /admin/editions,
 * /admin/entitlements and /admin/gateways. Read-only, so no CQRS command/consumer.
 * Platform operators only (the set the web screens gate on: ADMIN_PLATFORM_ROLES).
 *
 *   GET /v1/admin/editions      editions = composition.org_profile + tenant counts
 *   GET /v1/admin/entitlements  edition default modules + tenant overrides
 *   GET /v1/admin/gateways      SMS / WhatsApp / Email / Push health from integration_settings
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireSuperAdmin } from "../../shared/context.js";
import * as repo from "./repo.js";

const READ_LIMIT = { rateLimit: { max: 60, timeWindow: "1 minute" } } as const;

export async function platformCatalogueRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/editions", { config: READ_LIMIT }, async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const data = await repo.listEditions();
    return reply.send({ data, total: data.length, generatedAt: new Date().toISOString() });
  });

  app.get("/v1/admin/entitlements", { config: READ_LIMIT }, async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { rows, truncated } = await repo.listEntitlements();
    return reply.send({ data: rows, total: rows.length, truncated, generatedAt: new Date().toISOString() });
  });

  app.get("/v1/admin/gateways", { config: READ_LIMIT }, async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const data = await repo.listGateways();
    return reply.send({ data, total: data.length, generatedAt: new Date().toISOString() });
  });
}
