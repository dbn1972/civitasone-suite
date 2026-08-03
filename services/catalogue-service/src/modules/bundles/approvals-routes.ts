/**
 * PC-006 — bundle pricing approvals (maker-checker). Mutations publish → 202.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as approvalRepo from "./approvals-repo.js";
import { checkMakerChecker } from "../products/version-domain.js";
import type { BundleApprovalRow } from "../products/governance-schema.js";
import * as commands from "./commands.js";

const READ_ROLES = ["catalogue_user", "catalogue_admin", "catalogue_approver", "super_admin"];
const REQUEST_ROLES = ["catalogue_admin", "super_admin"];
const DECIDE_ROLES = ["catalogue_approver", "catalogue_admin", "super_admin"];
const MIN_REASON_LENGTH = 10;
const idParam = z.object({ id: z.string().uuid() });
const approvalIdParam = z.object({ approvalId: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const requestBody = z.object({
  pricingAmountMinor: z.coerce.bigint().nonnegative(),
  currency: z.string().length(3).regex(/^[A-Z]{3}$/, "currency must be an uppercase ISO 4217 code"),
  reason: z.string().min(1).max(2000).optional(),
});
const decideBody = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().max(2000).optional(),
});

function serialiseApproval(row: BundleApprovalRow) {
  return {
    id: row.id,
    bundleId: row.bundleId,
    status: row.status,
    requestedBy: row.requestedBy,
    approvedBy: row.approvedBy,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    reason: row.reason,
    pricingAmountMinor: row.pricingAmountMinor === null ? null : row.pricingAmountMinor.toString(),
    currency: row.currency,
    createdAt: row.createdAt,
    version: row.version,
  };
}

export async function bundleApprovalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/catalogue/bundles/:id/approvals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const q = listQuery.parse(req.query);
    const bundle = await repo.findById(id, ctx.tenantId);
    if (!bundle) throw new HttpError(404, "NOT_FOUND", "Bundle not found");
    const { rows, total } = await approvalRepo.listApprovals(id, ctx.tenantId, q.limit, q.offset);
    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({ data: rows.map(serialiseApproval), meta: { page, pageSize: q.limit, total } });
  });

  app.post("/v1/catalogue/bundles/:id/approvals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REQUEST_ROLES);
    const { id } = idParam.parse(req.params);
    const body = requestBody.parse(req.body);
    const bundle = await repo.findById(id, ctx.tenantId);
    if (!bundle) throw new HttpError(404, "NOT_FOUND", "Bundle not found");
    const pending = await approvalRepo.findPendingApproval(id, ctx.tenantId);
    if (pending) {
      throw new HttpError(422, "APPROVAL_ALREADY_PENDING", "This bundle already has a pending pricing approval");
    }
    return reply.code(202).send(
      await commands.requestBundleApproval(ctx, id, {
        pricingAmountMinor: body.pricingAmountMinor.toString(),
        currency: body.currency,
        reason: body.reason ?? null,
      }),
    );
  });

  app.post("/v1/catalogue/bundles/approvals/:approvalId/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DECIDE_ROLES);
    const { approvalId } = approvalIdParam.parse(req.params);
    const body = decideBody.parse(req.body);
    const approval = await approvalRepo.findApprovalById(approvalId, ctx.tenantId);
    if (!approval) throw new HttpError(404, "NOT_FOUND", "Bundle approval not found");
    if (approval.status !== "pending") {
      throw new HttpError(422, "ALREADY_DECIDED", `Approval is already '${approval.status}'`);
    }
    const maker = checkMakerChecker(approval.requestedBy, ctx.actorId);
    if (!maker.valid) {
      throw new HttpError(422, "MAKER_CHECKER_VIOLATION", "Maker-checker violation: the requester cannot decide their own bundle pricing approval");
    }
    if (body.decision === "rejected" && (body.reason === undefined || body.reason.trim().length < MIN_REASON_LENGTH)) {
      throw new HttpError(422, "REASON_REQUIRED", `A rejection reason of at least ${MIN_REASON_LENGTH} characters is required`);
    }
    return reply.code(202).send(
      await commands.decideBundleApproval(ctx, approvalId, {
        bundleId: approval.bundleId,
        decision: body.decision,
        reason: body.reason ?? approval.reason,
        requestedBy: approval.requestedBy,
        version: approval.version,
        pricingAmountMinor: approval.pricingAmountMinor === null ? null : approval.pricingAmountMinor.toString(),
        decidedAt: new Date().toISOString(),
      }),
    );
  });
}
