import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as allotmentsRepo from "../allotments/repo.js";
import * as commands from "./commands.js";
import { canTransition } from "./domain.js";

const USER_ROLES = ["market_user", "market_admin", "super_admin"];
const ADMIN_ROLES = ["market_admin", "super_admin"];

const transferBody = z.object({
  allotmentId: z.string().uuid(),
  transfereeName: z.string().min(1).max(256),
  transfereeAadhaar: z.string().length(12).optional(),
  reason: z.string().optional(),
});

const cancellationBody = z.object({
  allotmentId: z.string().uuid(),
  reason: z.string().optional(),
});

const evictionBody = z.object({
  allotmentId: z.string().uuid(),
  reason: z.string().min(1),
});

const rejectBody = z.object({
  reason: z.string().min(1),
});

const allotmentParam = z.object({ allotmentId: z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

export async function lifecycleRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/market/lifecycle/transfer", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const body = transferBody.parse(req.body);
    const allotment = await allotmentsRepo.findById(body.allotmentId, ctx.tenantId);
    if (!allotment) throw new HttpError(404, "ALLOTMENT_NOT_FOUND", "Allotment not found");
    return reply.code(202).send(await commands.requestTransfer(ctx, body));
  });

  app.post("/v1/market/lifecycle/cancellation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const body = cancellationBody.parse(req.body);
    const allotment = await allotmentsRepo.findById(body.allotmentId, ctx.tenantId);
    if (!allotment) throw new HttpError(404, "ALLOTMENT_NOT_FOUND", "Allotment not found");
    return reply.code(202).send(await commands.requestCancellation(ctx, body.allotmentId, body.reason));
  });

  app.post("/v1/market/lifecycle/eviction", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = evictionBody.parse(req.body);
    const allotment = await allotmentsRepo.findById(body.allotmentId, ctx.tenantId);
    if (!allotment) throw new HttpError(404, "ALLOTMENT_NOT_FOUND", "Allotment not found");
    return reply.code(202).send(await commands.initiateEviction(ctx, body.allotmentId, body.reason));
  });

  app.get("/v1/market/allotments/:allotmentId/lifecycle", async (req, reply) => {
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

  app.post("/v1/market/lifecycle/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "REQUEST_NOT_FOUND", "Lifecycle request not found");
    if (!["submitted", "under_review"].includes(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot approve request in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.approveRequest(ctx, id));
  });

  app.post("/v1/market/lifecycle/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = rejectBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "REQUEST_NOT_FOUND", "Lifecycle request not found");
    if (!["submitted", "under_review"].includes(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot reject request in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.rejectRequest(ctx, id, body.reason));
  });

  app.post("/v1/market/lifecycle/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "REQUEST_NOT_FOUND", "Lifecycle request not found");
    if (existing.status !== "approved") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot complete request in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.completeRequest(ctx, id));
  });
}
