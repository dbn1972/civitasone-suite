import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { getHealthScoreByAccount, listConfigs } from "./queries.js";
import { publishCreateConfig, publishUpdateConfig, publishRecomputeHealthScore } from "./commands.js";
import { createConfigBody, updateConfigBody, configIdParam, accountIdParam, listConfigsQuery } from "./validators.js";
import { randomUUID } from "node:crypto";

const ADMIN_ROLES = ["crm_admin", "super_admin"];
const READ_ROLES = ["crm_user", "crm_admin", "super_admin"];

export async function healthScoreRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/crm/accounts/:accountId/health-score — read current score
  app.get("/v1/crm/accounts/:accountId/health-score", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { accountId } = accountIdParam.parse(req.params);

    const score = await getHealthScoreByAccount(ctx.tenantId, accountId);
    if (!score) {
      throw new HttpError(404, "NOT_FOUND", "health score not found for this account");
    }
    return reply.send({ data: score });
  });

  // POST /v1/crm/accounts/:accountId/health-score/recompute — trigger recomputation
  app.post("/v1/crm/accounts/:accountId/health-score/recompute", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { accountId } = accountIdParam.parse(req.params);

    await publishRecomputeHealthScore(ctx, { accountId });
    return reply.code(202).send({ data: { accountId, status: "accepted" } });
  });

  // GET /v1/crm/health-score-configs — list configs
  app.get("/v1/crm/health-score-configs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const q = listConfigsQuery.parse(req.query);

    const rows = await listConfigs(ctx.tenantId, q);
    return reply.send({ data: rows, meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: rows.length } });
  });

  // POST /v1/crm/health-score-configs — create config
  app.post("/v1/crm/health-score-configs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createConfigBody.parse(req.body);

    const id = randomUUID();
    await publishCreateConfig(ctx, { id, ...body });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  // PATCH /v1/crm/health-score-configs/:id — update config
  app.patch("/v1/crm/health-score-configs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = configIdParam.parse(req.params);
    const body = updateConfigBody.parse(req.body);

    if (Object.keys(body).length === 0) {
      throw new HttpError(400, "EMPTY_BODY", "at least one field must be provided");
    }

    await publishUpdateConfig(ctx, { id, ...body });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });
}
