import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listQuerySchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as queries from "./queries.js";
import { closePfChallan } from "./challan-close.js";

const READER_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"];
const CHALLAN_CLOSE_ROLES = ["payroll_admin", "super_admin"];

/** GAP-PAYROLL-STATUTORY-PF-03 / ESI-03: optional one-period filter ("YYYY-MM"). */
const periodQuerySchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "period must be YYYY-MM").optional(),
});

export async function statutoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/statutory/pf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const { period } = periodQuerySchema.parse(req.query);
    return reply.send(await queries.listPfReport(ctx.tenantId, q.limit, period));
  });

  app.get("/v1/payroll/statutory/pf/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { period } = periodQuerySchema.parse(req.query);
    return reply.send(await queries.pfPeriodSummary(ctx.tenantId, period));
  });

  // UAT b18 D5: EPFO challan (A/c 1 / 2 / 10 / 21 / 22) for one wage month.
  app.get("/v1/payroll/statutory/pf/challan", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { period } = periodQuerySchema.parse(req.query);
    if (!period) throw new HttpError(400, "VALIDATION_FAILED", "period query param required in YYYY-MM format");
    return reply.send(await queries.pfChallanSummary(ctx.tenantId, period));
  });

  // Review SF3: close the month's EPF challan -- accrues the A/c 2 minimum shortfall once.
  app.post("/v1/payroll/statutory/pf/challan/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CHALLAN_CLOSE_ROLES);
    const { period } = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "period must be YYYY-MM") }).strict().parse(req.body);
    const r = await closePfChallan(ctx, period);
    return reply.code(r.alreadyClosed ? 200 : 201).send(r);
  });

  app.get("/v1/payroll/statutory/esi", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const { period } = periodQuerySchema.parse(req.query);
    return reply.send(await queries.listEsiReport(ctx.tenantId, q.limit, period));
  });

  app.get("/v1/payroll/statutory/esi/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { period } = periodQuerySchema.parse(req.query);
    return reply.send(await queries.esiPeriodSummary(ctx.tenantId, period));
  });

  app.get("/v1/payroll/statutory/tds", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    return reply.send(await queries.listTdsReport(ctx.tenantId, q.limit));
  });

  app.get("/v1/payroll/statutory/gratuity", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    return reply.send(await queries.listGratuityReport(ctx.tenantId, q.limit));
  });

  app.get("/v1/payroll/statutory/gpf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    return reply.send(await queries.listGpfReport(ctx.tenantId, q.limit));
  });

  app.get("/v1/payroll/statutory/nps", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    return reply.send(await queries.listNpsReport(ctx.tenantId, q.limit));
  });
}
