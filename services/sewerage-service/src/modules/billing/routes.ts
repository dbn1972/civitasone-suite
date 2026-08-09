import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const ROLES = ["sewerage_user", "sewerage_admin", "super_admin"];
const ADMIN_ROLES = ["sewerage_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  connectionId: z.string().uuid().optional(),
});

const generateBody = z.object({
  connectionId: z.string().uuid(),
  billingPeriod: z.string().min(1).max(24),
  amountMinor: z.number().int().positive(),
  dueDate: z.string(),
});

const payBody = z.object({
  paymentRef: z.string().min(1).max(64),
  version: z.number().int().positive(),
});

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/sewerage/bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = generateBody.parse(req.body);
    return reply.code(202).send(await commands.generateBill(ctx, body.connectionId, body.billingPeriod, body.amountMinor, body.dueDate));
  });

  app.get("/v1/sewerage/bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, q.connectionId);
    return reply.send({ data: rows.map(repo.toView), meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total } });
  });

  app.get("/v1/sewerage/bills/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const bill = await repo.findById(id, ctx.tenantId);
    if (!bill) throw new HttpError(404, "NOT_FOUND", "bill not found");
    return reply.send({ data: repo.toView(bill) });
  });

  app.post("/v1/sewerage/bills/:id/pay", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const body = payBody.parse(req.body);
    const bill = await repo.findById(id, ctx.tenantId);
    if (!bill) throw new HttpError(404, "NOT_FOUND", "bill not found");
    if (bill.status === "paid") throw new HttpError(422, "ALREADY_PAID", "bill already paid");
    if (body.version !== bill.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.payBill(ctx, id, body.paymentRef, body.version));
  });
}
