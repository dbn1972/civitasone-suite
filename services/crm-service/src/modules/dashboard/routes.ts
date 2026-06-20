import type { FastifyInstance } from "fastify";
import { CRMDashboardSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as queries from "./queries.js";

const ROLES = ["crm_user", "crm_admin", "super_admin", "sales_officer"];

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    sendValidated(reply, CRMDashboardSchema, await queries.getDashboard(ctx.tenantId));
  });
}
