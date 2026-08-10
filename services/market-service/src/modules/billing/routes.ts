import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const USER_ROLES = ["market_user", "market_admin", "super_admin"];
const ADMIN_ROLES = ["market_admin", "super_admin"];

const generateBody = z.object({
  allotmentId: z.string().uuid(),
  demandMonth: z.string().regex(/^\d{4}-\d{2}$/),
  amountMinor: z.number().int().positive(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lateFeeMinor: z.number().int().nonnegative().optional(),
});

const payBody = z.object({
  paymentRef: z.string().min(1),
});

const allotmentParam = z.object({ allotmentId: z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/market/demands", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = generateBody.parse(req.body);
    return reply.code(202).send(await commands.generateDemand(ctx, {
      ...body,
      amountMinor: BigInt(body.amountMinor),
      lateFeeMinor: body.lateFeeMinor !== undefined ? BigInt(body.lateFeeMinor) : undefined,
    }));
  });

  app.get("/v1/market/allotments/:allotmentId/demands", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { allotmentId } = allotmentParam.parse(req.params);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listByAllotment(allotmentId, ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.post("/v1/market/demands/:id/pay", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = payBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "DEMAND_NOT_FOUND", "Demand not found");
    if (!["generated", "sent", "overdue"].includes(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot pay demand in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.recordPayment(ctx, id, body.paymentRef));
  });

  app.post("/v1/market/demands/:id/waive", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "DEMAND_NOT_FOUND", "Demand not found");
    if (!["generated", "sent", "overdue"].includes(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot waive demand in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.waiveDemand(ctx, id));
  });
}
