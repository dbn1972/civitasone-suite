import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";

const ROLES = ["citizen", "citizen_officer", "citizen_admin", "super_admin"];

/** Stub routes for screens awaiting full implementation (contract coverage). */
export async function citizenGapRoutes(app: FastifyInstance): Promise<void> {
  // ─── Notification stubs ────────────────────────────────────────────────────

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

  // ─── Service requests ──────────────────────────────────────────────────────

  app.post("/v1/citizen/requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.code(202).send({
      data: {
        taskId: randomUUID(),
        id: randomUUID(),
        tenantId: ctx.tenantId,
        status: "submitted",
        message: "Request accepted",
      },
    });
  });

  app.get("/v1/citizen/requests/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const params = req.params as { id: string };
    return reply.send({
      data: {
        id: params.id,
        tenantId: ctx.tenantId,
        status: "submitted",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  });

  app.get("/v1/citizen/requests/:id/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const params = req.params as { id: string };
    return reply.send({
      data: {
        id: params.id,
        status: "submitted",
        updatedAt: new Date().toISOString(),
        history: [],
      },
    });
  });

  app.patch("/v1/citizen/requests/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const params = req.params as { id: string };
    return reply.send({ data: { id: params.id, status: "updated" } });
  });

  // ─── Citizen profile GET / PATCH ───────────────────────────────────────────

  app.get("/v1/citizen/profiles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const params = req.params as { id: string };
    return reply.send({ data: { id: params.id, tenantId: ctx.tenantId } });
  });

  app.patch("/v1/citizen/profiles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const params = req.params as { id: string };
    return reply.code(202).send({ data: { taskId: randomUUID(), id: params.id } });
  });
}
