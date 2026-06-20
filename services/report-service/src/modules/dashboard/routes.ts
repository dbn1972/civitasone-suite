import type { FastifyInstance } from "fastify";
import { ReportDashboardSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole } from "../../shared/context.js";

const ROLES = ["report_user", "report_admin", "super_admin"];

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/reports/dashboards", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    sendValidated(reply, ReportDashboardSchema, { kpis: [], summary: "Reports dashboard ready" });
  });
}
