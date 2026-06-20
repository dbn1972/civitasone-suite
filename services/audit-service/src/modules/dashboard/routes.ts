import type { FastifyInstance } from "fastify";
import { AuditDashboardSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as queries from "./queries.js";

const ROLES = ["audit_officer", "audit_admin", "super_admin", "cag_officer"];

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/audit/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    sendValidated(reply, AuditDashboardSchema, await queries.getDashboard(ctx.tenantId));
  });
}
