import type { FastifyInstance } from "fastify";
import { StockDashboardSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as queries from "./queries.js";

const ROLES = ["store_officer", "store_admin", "super_admin"];

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/stock/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    sendValidated(reply, StockDashboardSchema, await queries.getDashboard(ctx.tenantId));
  });
}
