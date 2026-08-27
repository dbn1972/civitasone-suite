import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as allotmentsRepo from "../allotments/repo.js";
import { LIFECYCLE_ACTIONABLE_STATUSES } from "../allotments/domain.js";
import * as commands from "./commands.js";

// Pre-existing drive-by cleanup: `canTransition` was imported but never
// actually called anywhere in this file — the approve/reject/complete
// handlers below use plain array-literal status checks instead (unrelated to
// this PR's fixes, just removing the dead import while already deep in this
// file for the actionability-guard fix below).

// Re-review fix: request-creation and approval previously only checked that
// the allotment EXISTED, never that it was in a status transfer/cancellation/
// eviction actually applies to. completeRequest's atomic guard (consumer.ts,
// unchanged by this fix) already refuses at completion time — but by then the
// request has already been submitted and approved, the original HTTP caller
// long since got their 202, and the failure (a thrown error inside an async
// consumer) has no client-visible surface at all. Checking here instead gives
// an immediate, synchronous 422 at the two earliest points a caller could
// still act on it; the completion-time guard stays as the race-proof backstop
// for an allotment that changes status in the interim between approval and
// completion.
function assertAllotmentActionable(allotment: { status: string }): void {
  if (!LIFECYCLE_ACTIONABLE_STATUSES.includes(allotment.status)) {
    throw new HttpError(422, "ALLOTMENT_NOT_ACTIONABLE", `Allotment is in status '${allotment.status}', not eligible for a lifecycle action`);
  }
}

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
    assertAllotmentActionable(allotment);
    return reply.code(202).send(await commands.requestTransfer(ctx, body));
  });

  app.post("/v1/market/lifecycle/cancellation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const body = cancellationBody.parse(req.body);
    const allotment = await allotmentsRepo.findById(body.allotmentId, ctx.tenantId);
    if (!allotment) throw new HttpError(404, "ALLOTMENT_NOT_FOUND", "Allotment not found");
    assertAllotmentActionable(allotment);
    return reply.code(202).send(await commands.requestCancellation(ctx, body.allotmentId, body.reason));
  });

  app.post("/v1/market/lifecycle/eviction", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = evictionBody.parse(req.body);
    const allotment = await allotmentsRepo.findById(body.allotmentId, ctx.tenantId);
    if (!allotment) throw new HttpError(404, "ALLOTMENT_NOT_FOUND", "Allotment not found");
    assertAllotmentActionable(allotment);
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
    // Re-review fix: the allotment's status can have changed since this
    // request was submitted (e.g. a different request against the same
    // allotment completed first) — re-check here rather than only finding out
    // at async completion time with no client-visible error.
    const allotment = await allotmentsRepo.findById(existing.allotmentId, ctx.tenantId);
    if (!allotment) throw new HttpError(404, "ALLOTMENT_NOT_FOUND", "Allotment not found");
    assertAllotmentActionable(allotment);
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
