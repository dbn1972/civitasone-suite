import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";

const ROLES = ["project_officer", "project_admin", "finance_officer", "super_admin"];

/** Stub routes for screens awaiting full implementation (contract coverage). */
export async function projectGapRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/projects/beneficiaries", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 15, total: 0 } });
  });

  app.get("/v1/projects/delay-analysis", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 15, total: 0 } });
  });

  app.get("/v1/projects/dprs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 15, total: 0 } });
  });

  app.get("/v1/projects/escalations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 15, total: 0 } });
  });

  app.get("/v1/projects/wbs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 15, total: 0 } });
  });
}
