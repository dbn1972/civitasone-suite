import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const TRADE_ROLES = ["trade_user", "trade_admin", "super_admin"];

const createBody = z.object({
  businessName: z.string().min(1).max(256),
  tradeCategory: z.string().min(1).max(64),
  subCategory: z.string().max(64).optional(),
  ownerName: z.string().min(1).max(256),
  premisesAddress: z.object({
    line1: z.string().min(1),
    line2: z.string().optional(),
    city: z.string().min(1),
    pin: z.string().min(6).max(6),
    ward: z.string().optional(),
    zone: z.string().optional(),
  }),
  areaInSqft: z.number().int().nonnegative().optional(),
  employeeCount: z.number().int().nonnegative().optional(),
  documents: z.array(z.object({
    docType: z.string(),
    fileId: z.string().uuid(),
    uploadedAt: z.string().datetime(),
  })).optional(),
});

const listQuery = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

const feePaymentBody = z.object({
  transactionId: z.string().min(1).max(128),
});

export async function applicationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/trade/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TRADE_ROLES);
    const body = createBody.parse(req.body);
    return reply.code(202).send(await commands.createApplication(ctx, body));
  });

  app.get("/v1/trade/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TRADE_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({ data: rows, meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total } });
  });

  app.get("/v1/trade/applications/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TRADE_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `trade:${ctx.tenantId}:application:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    return reply.send({ data: row });
  });

  app.post("/v1/trade/applications/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TRADE_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (existing.status !== "draft") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot submit application in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.submitApplication(ctx, id));
  });

  app.post("/v1/trade/applications/:id/withdraw", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TRADE_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (!["draft", "submitted"].includes(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot withdraw application in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.withdrawApplication(ctx, id));
  });

  app.post("/v1/trade/applications/:id/fee-payment", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TRADE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = feePaymentBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (existing.feePaid) throw new HttpError(409, "FEE_ALREADY_PAID", "Fee has already been paid");
    return reply.code(202).send(await commands.recordFeePayment(ctx, id, body.transactionId));
  });
}
