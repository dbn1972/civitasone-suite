import type { FastifyInstance } from "fastify";
import { ProjectsDashboardSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as queries from "./queries.js";

const ROLES = ["project_manager", "project_officer", "project_admin", "super_admin", "engineer", "finance_officer"];

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/projects/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    sendValidated(reply, ProjectsDashboardSchema, await queries.getDashboard(ctx.tenantId));
  });
}
