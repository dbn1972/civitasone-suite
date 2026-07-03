import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";
import { searchQueryParams } from "./validators.js";
import * as repo from "./repo.js";

const ROLES = ["knowledge_user", "knowledge_admin", "super_admin"];

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/knowledge/search", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const params = searchQueryParams.parse(req.query);
    const tags = params.tags ? params.tags.split(",").map((t) => t.trim()) : undefined;
    const results = await repo.search(
      ctx.tenantId,
      params.q,
      params.category,
      tags,
      params.limit,
      params.offset,
    );
    return reply.send(results);
  });
}
