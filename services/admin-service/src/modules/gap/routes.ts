import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";

const ROLES = ["tenant_admin", "platform_admin", "super_admin"];

/** Stub routes for screens awaiting full implementation (contract coverage). */
export async function adminGapRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/compliance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: { score: 0, checks: [] } });
  });

  app.get("/v1/admin/data-exports", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 15, total: 0 } });
  });

  app.get("/v1/admin/domains", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 15, total: 0 } });
  });

  app.get("/v1/admin/idp/providers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 15, total: 0 } });
  });

  app.get("/v1/admin/mfa/users", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 15, total: 0 } });
  });

  app.get("/v1/admin/org-hierarchy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 15, total: 0 } });
  });

  app.get("/v1/admin/security/overview", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: { threatLevel: "low", incidents: 0, lastScan: null } });
  });

  app.get("/v1/admin/siem/alerts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 15, total: 0 } });
  });

  app.get("/v1/admin/sso/providers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 15, total: 0 } });
  });

  app.get("/v1/admin/usage", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: { users: 0, storage: 0, apiCalls: 0 } });
  });
}
