import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import * as reqRepo from "../requests/repo.js";
import { getNextApprovalLevel } from "./domain.js";

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
 * and `getNextApprovalLevel` both already existed to support this but neither
 * was ever called anywhere — nothing stopped a caller from submitting a
 * level-2 decision directly, which `isFullyApproved()` in
 * processing/consumer.ts would then treat as a complete approval, fully
 * approving a refund with zero level-1 review. This enforces that an action
 * at level N is only valid once level N-1 has an approved decision on record
 * (level 1 requires no predecessor), and correctly refuses any further
 * action once the request is already fully approved.
 */
async function assertNextApprovalLevel(requestId: string, tenantId: string, level: number): Promise<void> {
  const maxApprovedLevel = await repo.getMaxApprovalLevel(requestId, tenantId);
  const expectedLevel = getNextApprovalLevel(maxApprovedLevel);
  if (expectedLevel === null || level !== expectedLevel) {
    throw new HttpError(
      422,
      "APPROVAL_SEQUENCE_INVALID",
      expectedLevel === null
        ? "Request is already fully approved; no further approval level is valid"
        : `Expected an approval action at level ${expectedLevel}, got level ${level}`,
    );
  }
}

/**
 * GAP2-REFUND-APPROVAL-01 / segregation-of-duties: the two-level maker-checker
 * (level 1 CHECKER, level 2 AUTHORIZER) previously enforced level *ordering*
 * only (assertNextApprovalLevel) and never that a *different* officer performs
 * each level, nor that the approver is not the request's creator. One officer
 * holding refund_admin/refund_approver/super_admin could approve level 1 then
 * level 2 on the same request, fully approving a monetary refund alone — a
 * self-approval bypass on a money-disbursing workflow. This rejects an approve
 * when the actor is the request's creator, or has already recorded an approved
 * decision at a lower level in the current round. The authoritative duplicate
 * of this check runs in processing/consumer.ts under lockForStatusChange (so a
 * racing pair of approve commands can't both pass a read-before-write), but
 * doing it here too gives the caller a synchronous 409 instead of a silent
 * swallow in the consumer.
 */
function assertNotSelfApproval(actorId: string, createdBy: string, actorAlreadyApproved: boolean): void {
  if (actorId === createdBy) {
    throw new HttpError(
      409,
      "SELF_APPROVAL_FORBIDDEN",
      "The officer who created this refund request may not approve it (segregation of duties)",
    );
  }
  if (actorAlreadyApproved) {
    throw new HttpError(
      409,
      "SELF_APPROVAL_FORBIDDEN",
      "An officer who already approved a lower level of this refund may not also approve the next level (segregation of duties)",
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
    const actorAlreadyApproved = await repo.hasActorAlreadyApproved(body.requestId, ctx.tenantId, ctx.actorId);
    assertNotSelfApproval(ctx.actorId, request.createdBy, actorAlreadyApproved);
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
