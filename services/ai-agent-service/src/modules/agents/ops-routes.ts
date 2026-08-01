import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import { GOVERNANCE_ROLES } from "../../shared/roles.js";
import * as agentsRepo from "./repo.js";
import * as orchestrationRepo from "./orchestration-repo.js";
import * as governanceRepo from "../governance/repo.js";
import { buildAgentOpsRow, buildOpsSummary, type AgentOpsRow } from "./ops-domain.js";

const agentsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["active", "paused", "archived"]).optional(),
});

const orchestrationsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["running", "completed", "failed", "aborted"]).optional(),
  rootAgentId: z.string().uuid().optional(),
});

/** Ops reads are cache-first: the console polls, and every poll must not hit Postgres. */
const OPS_TTL_SECONDS = 30;

export async function opsRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/ai/ops/agents — every agent with live status + activity counters (AG-002)
  app.get("/v1/ai/ops/agents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GOVERNANCE_ROLES);
    const q = agentsQuery.parse(req.query);

    const hash = `${q.limit}:${q.offset}:${q.status ?? "all"}`;
    const key = cache.makeKey(ctx.tenantId, "ops-agents", hash);

    const loaded = await cache.getOrLoad(
      key,
      async () => {
        const [{ rows, total }, activeCounts, errorCounts] = await Promise.all([
          agentsRepo.listByTenant(ctx.tenantId, q.limit, q.offset, {
            ...(q.status !== undefined ? { status: q.status } : {}),
          }),
          orchestrationRepo.activeCountsByAgent(ctx.tenantId),
          governanceRepo.blockedCountsByAgent(ctx.tenantId),
        ]);

        const data: AgentOpsRow[] = rows.map((r) =>
          buildAgentOpsRow({
            id: r.id,
            name: r.name,
            status: r.status,
            activeOrchestrations: activeCounts[r.id] ?? 0,
            errorCount: errorCounts[r.id] ?? 0,
          }),
        );

        return { data, total };
      },
      OPS_TTL_SECONDS,
    );

    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({
      data: loaded?.data ?? [],
      meta: { page, pageSize: q.limit, total: loaded?.total ?? 0 },
    });
  });

  // GET /v1/ai/ops/orchestrations — paginated, filterable orchestration list (AG-002)
  app.get("/v1/ai/ops/orchestrations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GOVERNANCE_ROLES);
    const q = orchestrationsQuery.parse(req.query);

    const hash = `${q.limit}:${q.offset}:${q.status ?? "all"}:${q.rootAgentId ?? "all"}`;
    const key = cache.makeKey(ctx.tenantId, "ops-orchestrations", hash);

    const loaded = await cache.getOrLoad(
      key,
      async () => {
        const { rows, total } = await orchestrationRepo.listByTenant(ctx.tenantId, q.limit, q.offset, {
          ...(q.status !== undefined ? { status: q.status } : {}),
          ...(q.rootAgentId !== undefined ? { rootAgentId: q.rootAgentId } : {}),
        });
        return { data: rows.map(orchestrationRepo.toView), total };
      },
      OPS_TTL_SECONDS,
    );

    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({
      data: loaded?.data ?? [],
      meta: { page, pageSize: q.limit, total: loaded?.total ?? 0 },
    });
  });

  // GET /v1/ai/ops/summary — tenant-level orchestration counters (AG-002)
  app.get("/v1/ai/ops/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GOVERNANCE_ROLES);

    const key = cache.makeKey(ctx.tenantId, "ops-summary", "current");
    const loaded = await cache.getOrLoad(
      key,
      async () => {
        const [counts, stats] = await Promise.all([
          orchestrationRepo.countsByStatus(ctx.tenantId),
          orchestrationRepo.durationStats(ctx.tenantId),
        ]);
        return buildOpsSummary({
          running: counts.running ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
          aborted: counts.aborted ?? 0,
          avgHopCount: stats.avgHopCount,
          p95DurationMs: stats.p95DurationMs,
        });
      },
      OPS_TTL_SECONDS,
    );

    return reply.send({ data: loaded });
  });
}
