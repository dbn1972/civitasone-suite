/**
 * inspection-service: risk module — HTTP routes.
 *
 * CQRS write path: zod validate → queue.publish → 202 Accepted
 * CQRS read path: cache.getOrLoad → Postgres fallback
 *
 * Routes:
 *   POST /v1/inspection/risk/models         — Configure risk model (inspection_admin)
 *   GET  /v1/inspection/risk/models         — List risk models (inspection_admin)
 *   POST /v1/inspection/risk/scores/compute — Trigger score computation (planning_officer)
 *   GET  /v1/inspection/risk/scores/:entityId — Get entity risk score (planning_officer, inspector)
 *
 * _Requirements: 3.1, 3.2, 3.3_
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import * as queries from "./queries.js";

// ── Zod validators ────────────────────────────────────────────────────────────

const riskModelConfigureBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  factors: z.array(z.object({
    factorName: z.string().min(1).max(100),
    weight: z.number().min(0).max(1),
    scoringFunction: z.string().min(1).max(50),
    dataSource: z.string().min(1).max(100),
  })).min(1).max(50),
});

const riskScoreComputeBody = z.object({
  entityId: z.string().uuid(),
  modelId: z.string().uuid().optional(),
});

const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

// ── Roles ─────────────────────────────────────────────────────────────────────

const ADMIN_ROLES = ["inspection_admin", "super_admin"];
const PLANNING_ROLES = ["planning_officer", "inspection_admin", "super_admin"];
const SCORE_READ_ROLES = ["planning_officer", "inspector", "inspection_admin", "super_admin"];

// ── Route Registration ────────────────────────────────────────────────────────

export async function registerRiskRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/inspection/risk/models — configure a new risk model
  app.post("/v1/inspection/risk/models", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);

    const body = riskModelConfigureBody.parse(req.body);
    const result = await commands.publishRiskModelConfigure(body, ctx);

    return reply.code(202).send({ data: result });
  });

  // GET /v1/inspection/risk/models — list risk models (paginated)
  app.get("/v1/inspection/risk/models", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);

    const { page, pageSize } = paginationQuery.parse(req.query);
    const result = await repo.findModelsByTenant(ctx.tenantId, { page, pageSize });

    return reply.send(result);
  });

  // POST /v1/inspection/risk/scores/compute — trigger score computation
  app.post("/v1/inspection/risk/scores/compute", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLANNING_ROLES);

    const body = riskScoreComputeBody.parse(req.body);
    const result = await commands.publishRiskScoreCompute(body, ctx);

    return reply.code(202).send({ data: result });
  });

  // GET /v1/inspection/risk/scores/:entityId — get entity risk score + history
  app.get("/v1/inspection/risk/scores/:entityId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SCORE_READ_ROLES);

    const entityId = (req.params as { entityId: string }).entityId;
    if (!entityId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entityId)) {
      throw new HttpError(400, "INVALID_ENTITY_ID", "entityId must be a valid UUID");
    }

    // Current score via cache read-through.
    const currentScore = await repo.findScoreByEntity(ctx.tenantId, entityId);

    if (!currentScore) {
      throw new HttpError(404, "SCORE_NOT_FOUND", `No risk score found for entity ${entityId}`);
    }

    // Recent history for trend display.
    const { page, pageSize } = paginationQuery.parse(req.query);
    const history = await queries.getScoreHistory(ctx.tenantId, entityId, { page, pageSize });

    return reply.send({
      data: {
        current: currentScore,
        history: history.data,
      },
      meta: history.meta,
    });
  });
}
