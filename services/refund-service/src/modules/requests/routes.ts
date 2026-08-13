import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const REFUND_ROLES = ["refund_user", "refund_admin", "refund_approver", "super_admin"];

const createBody = z.object({
  applicantName: z.string().min(1).max(256),
  applicantPhone: z.string().min(10).max(15),
  originalServiceType: z.string().min(1).max(64),
  originalTransactionRef: z.string().min(1),
  originalAmountMinor: z.string().min(1),
  refundAmountMinor: z.string().min(1),
  refundReason: z.enum(["overpayment", "cancellation", "deposit_return", "duplicate_payment", "other"]),
  description: z.string().optional(),
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

export async function requestRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/refund/requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REFUND_ROLES);
    const body = createBody.parse(req.body);
    return reply.code(202).send(await commands.createRequest(ctx, body));
  });

  app.get("/v1/refund/requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REFUND_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.get("/v1/refund/requests/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REFUND_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `refund:${ctx.tenantId}:request:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "REQUEST_NOT_FOUND", "Refund request not found");
    return reply.send({ data: row });
  });

  app.post("/v1/refund/requests/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REFUND_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "REQUEST_NOT_FOUND", "Refund request not found");
    if (existing.status !== "requested") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot submit request in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.submitRequest(ctx, id));
  });

  app.post("/v1/refund/requests/:id/withdraw", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REFUND_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "REQUEST_NOT_FOUND", "Refund request not found");
    if (!["requested", "under_review"].includes(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot withdraw request in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.withdrawRequest(ctx, id));
  });
}
