import type { FastifyInstance } from "fastify";
import { FinanceDashboardSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, financeErrorHandler } from "../../shared/context.js";
import { z } from "zod";
import * as queries from "./queries.js";

const ROLES = ["finance_officer", "finance_admin", "super_admin", "budget_officer"];

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    // GAP-FINANCE-DASHBOARD-02: optional ?fy=YYYY-YY scopes the figures to that fiscal year.
    const q = z.object({
      fy: z.string().refine((v) => queries.fyDateBounds(v) !== null, "fy must be a fiscal year such as 2026-27").optional(),
    }).parse(req.query);
    sendValidated(reply, FinanceDashboardSchema, await queries.getDashboard(ctx.tenantId, q.fy));
  });

  app.setErrorHandler(financeErrorHandler);
}