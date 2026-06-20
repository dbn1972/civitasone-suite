import type { FastifyInstance } from "fastify";
import { ProcurementDashboardSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as queries from "./queries.js";

const ROLES = ["procurement_officer", "procurement_admin", "super_admin", "store_officer"];

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/procurement/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    sendValidated(reply, ProcurementDashboardSchema, await queries.getDashboard(ctx.tenantId));
  });
}
