import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as repo from "./repo.js";

const OFFICER_ROLES = ["citizen_officer", "citizen_admin", "super_admin"];

export async function packsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/citizen/packs/domain", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    return reply.send({ data: await repo.listDomainPacks(ctx.tenantId) });
  });

  app.get("/v1/citizen/packs/services", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const domainPackKey = typeof (req.query as { domainPackKey?: string }).domainPackKey === "string"
      ? (req.query as { domainPackKey: string }).domainPackKey
      : undefined;
    return reply.send({ data: await repo.listServicePacks(ctx.tenantId, domainPackKey) });
  });
}
