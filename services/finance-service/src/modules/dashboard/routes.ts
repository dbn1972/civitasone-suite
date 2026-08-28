import type { FastifyInstance } from "fastify";
import { FinanceDashboardSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, financeErrorHandler } from "../../shared/context.js";
import * as queries from "./queries.js";

const ROLES = ["finance_officer", "finance_admin", "super_admin", "budget_officer"];

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    sendValidated(reply, FinanceDashboardSchema, await queries.getDashboard(ctx.tenantId));
  });

  app.setErrorHandler(financeErrorHandler);
}