import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";
import { countProposals, proposalStatusCounts, listProposalsForReport } from "../proposal/repo.js";
import { countClosures } from "../execution/repo.js";
import { reportFiltersSchema, parseReportFilters } from "./validators.js";

const READ_ROLES = ["works_admin", "works_operator", "works_viewer", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];

export async function reportingRoutes(app: FastifyInstance): Promise<void> {
  // Works summary report — real tenant counts (total/active/closed).
  app.get("/v1/works/reports/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = reportFiltersSchema.parse(req.query);
    const filters = parseReportFilters(query);
    const scope = { fromDate: filters.fromDate, toDate: filters.toDate, divisionId: filters.divisionId };
    const [totalWorks, closedWorks] = await Promise.all([
      countProposals(ctx.tenantId, scope),
      countClosures(ctx.tenantId, scope),
    ]);
    return reply.send({
      data: {
        totalWorks,
        activeWorks: Math.max(totalWorks - closedWorks, 0),
        closedWorks,
      },
      meta: { filters: scope },
    });
  });

  // Works status report — proposal counts grouped by lifecycle status.
  app.get("/v1/works/reports/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = reportFiltersSchema.parse(req.query);
    const filters = parseReportFilters(query);
    const scope = { fromDate: filters.fromDate, toDate: filters.toDate, divisionId: filters.divisionId };
    const data = await proposalStatusCounts(ctx.tenantId, scope);
    return reply.send({ data, meta: { filters: scope } });
  });

  // Paginated works register for reporting dashboards.
  app.get("/v1/works/reports/works", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = reportFiltersSchema.parse(req.query);
    const filters = parseReportFilters(query);
    const data = await listProposalsForReport(ctx.tenantId, filters);
    return reply.send({
      data,
      meta: {
        page: filters.page,
        pageSize: filters.pageSize,
        total: data.length,
        filters: {
          fromDate: filters.fromDate?.toISOString(),
          toDate: filters.toDate?.toISOString(),
          divisionId: filters.divisionId,
        },
      },
    });
  });

  // Works dashboard — live KPI snapshot: total, active, closed, by-status.
  app.get("/v1/works/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const [totalWorks, statusCounts, closedWorks] = await Promise.all([
      countProposals(ctx.tenantId),
      proposalStatusCounts(ctx.tenantId),
      countClosures(ctx.tenantId),
    ]);
    const byStatus: Record<string, number> = {};
    for (const row of statusCounts) byStatus[row.status] = row.count;
    return reply.send({
      data: {
        totalWorks,
        activeWorks: Math.max(totalWorks - closedWorks, 0),
        closedWorks,
        byStatus,
      },
    });
  });
}
