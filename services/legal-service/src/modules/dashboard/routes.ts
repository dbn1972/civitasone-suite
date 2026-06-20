import type { FastifyInstance } from "fastify";
import { LegalDashboardSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as queries from "./queries.js";

const ROLES = ["legal_officer", "legal_admin", "super_admin"];

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/legal/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    sendValidated(reply, LegalDashboardSchema, await queries.getDashboard(ctx.tenantId));
  });
}
