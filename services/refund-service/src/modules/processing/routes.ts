import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import * as reqRepo from "../requests/repo.js";

const ADMIN_ROLES = ["refund_admin", "refund_approver", "super_admin"];

const reviewBody = z.object({ requestId: z.string().uuid() });
const approveBody = z.object({
  requestId: z.string().uuid(),
  level: z.number().int().min(1).max(2),
  remarks: z.string().optional(),
});
const rejectBody = z.object({
  requestId: z.string().uuid(),
  level: z.number().int().min(1).max(2),
  remarks: z.string().min(1),
});
const returnBody = z.object({
  requestId: z.string().uuid(),
  level: z.number().int().min(1).max(2),
  remarks: z.string().min(1),
});

const requestIdQuery = z.object({ requestId: z.string().uuid() });

export async function processingRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/refund/processing/review", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = reviewBody.parse(req.body);
    const request = await reqRepo.findById(body.requestId, ctx.tenantId);
    if (!request) throw new HttpError(404, "REQUEST_NOT_FOUND", "Refund request not found");
    if (request.status !== "under_review" && request.status !== "requested") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot review request in status '${request.status}'`);
    }
    return reply.code(202).send(await commands.reviewRequest(ctx, body.requestId));
  });

  app.post("/v1/refund/processing/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = approveBody.parse(req.body);
    const request = await reqRepo.findById(body.requestId, ctx.tenantId);
    if (!request) throw new HttpError(404, "REQUEST_NOT_FOUND", "Refund request not found");
    if (request.status !== "under_review") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot approve request in status '${request.status}'`);
    }
    return reply.code(202).send(
      await commands.approveRequest(ctx, body.requestId, body.level, body.remarks),
    );
  });

  app.post("/v1/refund/processing/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = rejectBody.parse(req.body);
    const request = await reqRepo.findById(body.requestId, ctx.tenantId);
    if (!request) throw new HttpError(404, "REQUEST_NOT_FOUND", "Refund request not found");
    if (request.status !== "under_review") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot reject request in status '${request.status}'`);
    }
    return reply.code(202).send(
      await commands.rejectRequest(ctx, body.requestId, body.level, body.remarks),
    );
  });

  app.post("/v1/refund/processing/return", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = returnBody.parse(req.body);
    const request = await reqRepo.findById(body.requestId, ctx.tenantId);
    if (!request) throw new HttpError(404, "REQUEST_NOT_FOUND", "Refund request not found");
    if (request.status !== "under_review") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot return request in status '${request.status}'`);
    }
    return reply.code(202).send(
      await commands.returnRequest(ctx, body.requestId, body.level, body.remarks),
    );
  });

  app.get("/v1/refund/processing/approvals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const q = requestIdQuery.parse(req.query);
    const records = await repo.listByRequest(q.requestId, ctx.tenantId);
    return reply.send({
      data: records,
      meta: { page: 1, pageSize: records.length, total: records.length },
    });
  });
}
