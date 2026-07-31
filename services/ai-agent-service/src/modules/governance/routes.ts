import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { GOVERNANCE_ROLES } from "../../shared/roles.js";
import * as repo from "./repo.js";
import * as agentsRepo from "../agents/repo.js";
import { summarizeBlockRate } from "./domain.js";

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  agentId: z.string().uuid().optional(),
  blocked: z.enum(["true", "false"]).optional(),
  action: z.string().max(100).optional(),
});

const summaryQuery = z.object({
  agentId: z.string().uuid().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function governanceRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/ai/governance/audit — paginated audit trail (redacted at write time)
  app.get("/v1/ai/governance/audit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GOVERNANCE_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, {
      ...(q.agentId !== undefined ? { agentId: q.agentId } : {}),
      ...(q.blocked !== undefined ? { blocked: q.blocked === "true" } : {}),
      ...(q.action !== undefined ? { action: q.action } : {}),
    });

    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({
      data: rows.map(repo.toView),
      meta: { page, pageSize: q.limit, total },
      summary: summarizeBlockRate(rows.map((r) => ({ blocked: r.blocked }))),
    });
  });

  // GET /v1/ai/governance/summary — block-rate statistics
  app.get("/v1/ai/governance/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GOVERNANCE_ROLES);
    const q = summaryQuery.parse(req.query);

    const { total, blocked } = await repo.countTotals(ctx.tenantId, {
      ...(q.agentId !== undefined ? { agentId: q.agentId } : {}),
    });

    const blockRatePct = total === 0 ? 0 : Math.round((blocked / total) * 10000) / 100;
    return reply.send({ data: { total, blocked, blockRatePct } });
  });

  // GET /v1/ai/governance/dashboard — headline governance counters
  app.get("/v1/ai/governance/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GOVERNANCE_ROLES);

    const [{ total, blocked }, activeAgents] = await Promise.all([
      repo.countTotals(ctx.tenantId, {}),
      agentsRepo.countByStatus(ctx.tenantId, "active"),
    ]);

    const blockRatePct = total === 0 ? 0 : Math.round((blocked / total) * 10000) / 100;
    return reply.send({
      data: { totalInvocations: total, blockedCount: blocked, blockRatePct, activeAgents },
    });
  });

  // GET /v1/ai/governance/audit/:id — single audit entry
  app.get("/v1/ai/governance/audit/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GOVERNANCE_ROLES);
    const { id } = idParam.parse(req.params);

    const entry = await repo.findById(id, ctx.tenantId);
    if (!entry) {
      throw new HttpError(404, "NOT_FOUND", "audit entry not found");
    }

    return reply.send({ data: repo.toView(entry) });
  });
}
