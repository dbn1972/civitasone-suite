import type { FastifyInstance } from "fastify";
import { listQuerySchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as queries from "./queries.js";

const READER_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"];

export async function statutoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/statutory/pf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    return reply.send(await queries.listPfReport(ctx.tenantId, q.limit));
  });

  app.get("/v1/payroll/statutory/esi", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    return reply.send(await queries.listEsiReport(ctx.tenantId, q.limit));
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
