/**
 * GAP-ADMIN-DISCOVERY-02: service discovery registry for the platform console.
 *   GET /v1/admin/discovery/services            -> the registered services with their last-known health
 *   GET /v1/admin/discovery/services?refresh=1  -> re-probe every service first (throttled)
 * platform_admin / super_admin only. Read-only: it reports what the health
 * module already knows (the service registry + the /health probe), it never
 * accepts a URL from the caller, so there is nothing to point at an internal host.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireSuperAdmin, HttpError } from "../../shared/context.js";
import { DEFAULT_SERVICES } from "../health/domain.js";
import * as queries from "../health/queries.js";

const query = z.object({ refresh: z.enum(["1", "true", "0", "false"]).optional() }).strict();

export async function discoveryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/discovery/services", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const q = query.safeParse(req.query ?? {});
    if (!q.success) throw new HttpError(400, "VALIDATION_FAILED", "refresh must be 1 or 0");
    const refresh = q.data.refresh === "1" || q.data.refresh === "true";
    const { health, throttled } = refresh
      ? await queries.scanAggregateHealth()
      : { health: await queries.getAggregateHealth(), throttled: false };
    if (!health) throw new HttpError(503, "UNAVAILABLE", "service health is unavailable right now");
    const data = health.services.map((s) => ({
      serviceName: s.service,
      port: DEFAULT_SERVICES.find((d) => d.name === s.service)?.port ?? null,
      status: s.status,
      httpStatus: s.httpStatus ?? null,
    }));
    return reply.send({ data, meta: { total: data.length, overall: health.status, checkedAt: health.checkedAt, throttled } });
  });
}
