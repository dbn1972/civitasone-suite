import type { FastifyInstance } from "fastify";
import { FinanceDashboardSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, financeErrorHandler } from "../../shared/context.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { queue } from "../../shared/infra.js";
import * as queries from "./queries.js";
import { buildMisCsv, misFileName, type MisDashboard } from "./mis.js";
import { MIS_EXPORT_TOPIC } from "./consumer.js";

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

  // GAP-FINANCE-DASHBOARD-06: MIS export. A CSV of the dashboard figures for the FY. The
  // route never writes the DB: it publishes a command whose consumer enqueues the audit event.
  app.get("/v1/finance/dashboard/mis-export", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = z.object({
      fy: z.string().refine((v) => queries.fyDateBounds(v) !== null, "fy must be a fiscal year such as 2026-27"),
    }).parse(req.query);
    const data = await queries.getDashboard(ctx.tenantId, q.fy);
    const csv = buildMisCsv(q.fy, data as MisDashboard, new Date().toISOString());
    await queue.publish(MIS_EXPORT_TOPIC, {
      messageId: randomUUID(), type: MIS_EXPORT_TOPIC,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { tenantId: ctx.tenantId, fy: q.fy },
    });
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${misFileName(q.fy)}"`)
      .send(csv);
  });

  app.setErrorHandler(financeErrorHandler);
}