import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";
import { countProposals, proposalStatusCounts } from "../proposal/repo.js";
import { countClosures } from "../execution/repo.js";

const READ_ROLES = ["works_admin", "works_operator", "works_viewer", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];

export async function reportingRoutes(app: FastifyInstance): Promise<void> {
  // Works summary report — real tenant counts (total/active/closed).
  app.get("/v1/works/reports/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const [totalWorks, closedWorks] = await Promise.all([
      countProposals(ctx.tenantId),
      countClosures(ctx.tenantId),
    ]);
    return reply.send({
      data: {
        totalWorks,
        activeWorks: Math.max(totalWorks - closedWorks, 0),
        closedWorks,
      },
    });
  });

  // Works status report — proposal counts grouped by lifecycle status.
  app.get("/v1/works/reports/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const data = await proposalStatusCounts(ctx.tenantId);
    return reply.send({ data });
  });
}
