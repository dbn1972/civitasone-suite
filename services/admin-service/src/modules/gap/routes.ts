import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";

const ROLES = ["tenant_admin", "platform_admin", "super_admin"];

/** Stub routes for screens awaiting full implementation (contract coverage). */
export async function adminGapRoutes(app: FastifyInstance): Promise<void> {
  // ─── Security / compliance stubs ───────────────────────────────────────────

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

  // ─── User management ────────────────────────────────────────────────────────

  app.get("/v1/admin/users", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
  });

  app.post("/v1/admin/users", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.code(201).send({ data: { id: randomUUID(), tenantId: ctx.tenantId } });
  });

  app.patch("/v1/admin/users/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const params = req.params as { id: string };
    return reply.send({ data: { id: params.id } });
  });

  // ─── Role management ─────────────────────────────────────────────────────────

  app.get("/v1/admin/roles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
  });

  app.post("/v1/admin/roles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.code(201).send({ data: { id: randomUUID() } });
  });

  app.patch("/v1/admin/roles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const params = req.params as { id: string };
    return reply.send({ data: { id: params.id } });
  });

  // ─── Permission management ────────────────────────────────────────────────────

  app.get("/v1/admin/permissions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
  });

  app.patch("/v1/admin/roles/:id/permissions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const params = req.params as { id: string };
    return reply.send({ data: { roleId: params.id, updated: true } });
  });

  // ─── Audit logs ────────────────────────────────────────────────────────────────

  app.get("/v1/admin/audit-logs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
  });

  // ─── Feature flag aliases (/feature-flags is canonical; /features for test compat) ─

  app.get("/v1/admin/features", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
  });

  app.patch("/v1/admin/features/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const params = req.params as { id: string };
    return reply.send({ data: { id: params.id, updated: true } });
  });
}
