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

/**
 * FIN-2 / maker-checker: approve/reject/return must happen in strict level
 * order (level 1 "checker" before level 2 "authorizer"). `repo.getMaxApprovalLevel`
 * already existed to support this but was never called anywhere — nothing
 * stopped a caller from submitting a level-2 decision directly, which
 * `isFullyApproved()` in processing/consumer.ts would then treat as a
 * complete approval, fully approving a refund with zero level-1 review.
 * This enforces that an action at level N is only valid once level N-1 has
 * an approved decision on record (level 1 requires no predecessor).
 */
async function assertNextApprovalLevel(requestId: string, tenantId: string, level: number): Promise<void> {
  const maxApprovedLevel = await repo.getMaxApprovalLevel(requestId, tenantId);
  if (level !== maxApprovedLevel + 1) {
    throw new HttpError(
      422,
      "APPROVAL_SEQUENCE_INVALID",
      `Expected an approval action at level ${maxApprovedLevel + 1}, got level ${level}`,
    );
  }
}

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
    await assertNextApprovalLevel(body.requestId, ctx.tenantId, body.level);
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
    await assertNextApprovalLevel(body.requestId, ctx.tenantId, body.level);
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
    await assertNextApprovalLevel(body.requestId, ctx.tenantId, body.level);
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
