import type { FastifyInstance } from "fastify";
import { AssetDashboardSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as queries from "./queries.js";

const ROLES = ["asset_manager", "asset_admin", "super_admin", "audit_officer"];

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/assets/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    sendValidated(reply, AssetDashboardSchema, await queries.getDashboard(ctx.tenantId));
  });
}
