import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createConfigBody, patchConfigBody, idParam, listQuery, runsListQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ADMIN_ROLES = ["crm_admin", "super_admin"];
const READ_ROLES = ["crm_user", "crm_admin", "super_admin"];

export async function dueHorizonRoutes(app: FastifyInstance): Promise<void> {
  // List configs — crm_user can view
  app.get("/v1/crm/due-horizon-configs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuery.parse(req.query);
    const result = await queries.listConfigs(ctx.tenantId, q.limit, q.offset);
    return reply.send(result);
  });

  // Create config — crm_admin only
  app.post("/v1/crm/due-horizon-configs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createConfigBody.parse(req.body);
    const accepted = await commands.createConfig(ctx, body);
    return reply.code(202).send({ data: accepted });
  });

  // Patch config — crm_admin only
  app.patch("/v1/crm/due-horizon-configs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = patchConfigBody.parse(req.body);

    // Verify the config exists before accepting
    const existing = await queries.getConfig(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "due-horizon config not found");

    const accepted = await commands.updateConfig(ctx, id, body);
    return reply.code(202).send({ data: accepted });
  });

  // Trigger a sweep run — crm_admin only
  app.post("/v1/crm/due-horizon-configs/:id/run", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);

    // Verify the config exists and is active
    const existing = await queries.getConfig(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "due-horizon config not found");
    if (!existing.active) throw new HttpError(422, "CONFIG_INACTIVE", "cannot run sweep on inactive config");

    const accepted = await commands.triggerRun(ctx, id);
    return reply.code(202).send({ data: accepted });
  });

  // List runs — crm_user can view
  app.get("/v1/crm/due-horizon-runs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = runsListQuery.parse(req.query);
    const result = await queries.listRuns(ctx.tenantId, q.limit, q.offset, q.configId);
    return reply.send(result);
  });
}
