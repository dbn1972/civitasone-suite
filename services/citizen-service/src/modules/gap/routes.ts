import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";

const ROLES = ["citizen", "citizen_officer", "citizen_admin", "super_admin"];

/** Stub routes for screens awaiting full implementation (contract coverage). */
export async function citizenGapRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/citizen/alerts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 15, total: 0 } });
  });

  app.get("/v1/citizen/notices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 15, total: 0 } });
  });

  app.get("/v1/citizen/portal/metrics", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: { totalServices: 0, activeRequests: 0, resolvedThisMonth: 0, avgResolutionDays: 0 } });
  });

  app.get("/v1/citizen/surveys", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 15, total: 0 } });
  });
}
