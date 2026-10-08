import type { FastifyInstance } from "fastify";
import { listQuerySchema } from "@civitasone/schemas/common";
import { ReportDashboardSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as kpiQueries from "../kpis/queries.js";
// GAP2-REPORTS-ROLES-01: dashboard reads use the single canonical report
// reader vocabulary shared with jobs/kpis/mis/scheduled.
import { REPORT_READ_ROLES as ROLES } from "../../shared/roles.js";

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/reports/dashboards", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const items = await kpiQueries.listDashboardItems(ctx.tenantId, q.limit);
    sendValidated(reply, ReportDashboardSchema, {
      kpis: items,
      summary: items.length > 0 ? `${items.length} KPIs tracked` : "Reports dashboard ready",
    });
  });
  app.get("/v1/reports/executive-summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const kpis = await kpiQueries.listDashboardItems(ctx.tenantId, 10);
    return reply.send({
      data: {
        kpiHighlights: kpis.slice(0, 5),
        totalKpis: kpis.length,
        generatedAt: new Date().toISOString(),
      },
    });
  });

}
