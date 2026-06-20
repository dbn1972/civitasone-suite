import type { FastifyInstance } from "fastify";
import { HRDashboardSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as queries from "./queries.js";

const READER_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager"];

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    sendValidated(reply, HRDashboardSchema, await queries.getDashboard(ctx.tenantId));
  });
}
