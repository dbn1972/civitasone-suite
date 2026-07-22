import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";

const READ_ROLES = ["works_admin", "works_operator", "works_viewer", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];

export async function reportingRoutes(app: FastifyInstance): Promise<void> {
  // Works summary report
  app.get("/v1/works/reports/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    return reply.send({ data: { totalWorks: 0, activeWorks: 0, closedWorks: 0 } });
  });

  // Works status report
  app.get("/v1/works/reports/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    return reply.send({ data: [] });
  });
}
