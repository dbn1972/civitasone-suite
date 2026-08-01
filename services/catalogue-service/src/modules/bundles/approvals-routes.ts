/**
 * PC-006 — product bundling with pricing approvals (maker-checker).
 *
 * MONEY RULE: the proposed bundle price is `pricingAmountMinor`, a bigint of minor
 * units (paise). It is accepted as a JSON string, stored as bigint, and echoed
 * back as a string — so a price above 2^53 survives the round trip exactly.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as approvalRepo from "./approvals-repo.js";
import { checkMakerChecker } from "../products/version-domain.js";
import type { BundleApprovalRow } from "../products/governance-schema.js";

const READ_ROLES = ["catalogue_user", "catalogue_admin", "catalogue_approver", "super_admin"];
const REQUEST_ROLES = ["catalogue_admin", "super_admin"];
const DECIDE_ROLES = ["catalogue_approver", "catalogue_admin", "super_admin"];

/** Rejection reasons must be substantive enough to be auditable. */
const MIN_REASON_LENGTH = 10;

const idParam = z.object({ id: z.string().uuid() });
const approvalIdParam = z.object({ approvalId: z.string().uuid() });

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const requestBody = z.object({
  /** bigint minor units accepted as a string (or an integral number for convenience). */
  pricingAmountMinor: z.coerce.bigint().nonnegative(),
  currency: z.string().length(3).regex(/^[A-Z]{3}$/, "currency must be an uppercase ISO 4217 code"),
  reason: z.string().min(1).max(2000).optional(),
});

const decideBody = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().max(2000).optional(),
});

/** Serialise an approval row, converting bigint money to a string. */
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
    // MONEY RULE: bigint → string. Never a JSON number.
    pricingAmountMinor: row.pricingAmountMinor === null ? null : row.pricingAmountMinor.toString(),
    currency: row.currency,
    createdAt: row.createdAt,
    version: row.version,
  };
}

export async function bundleApprovalRoutes(app: FastifyInstance): Promise<void> {
  // ─── List a bundle's approvals ───────────────────────────────────────────────
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

  // ─── Request pricing approval ────────────────────────────────────────────────
  app.post("/v1/catalogue/bundles/:id/approvals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REQUEST_ROLES);
    const { id } = idParam.parse(req.params);
    const body = requestBody.parse(req.body);

    const bundle = await repo.findById(id, ctx.tenantId);
    if (!bundle) throw new HttpError(404, "NOT_FOUND", "Bundle not found");

    // One open request at a time, otherwise two checkers could approve two
    // different prices for the same bundle concurrently.
    const pending = await approvalRepo.findPendingApproval(id, ctx.tenantId);
    if (pending) {
      throw new HttpError(422, "APPROVAL_ALREADY_PENDING", "This bundle already has a pending pricing approval");
    }

    const approvalId = randomUUID();

    await db.transaction(async (tx) => {
      await approvalRepo.insertApproval(tx, {
        id: approvalId,
        tenantId: ctx.tenantId,
        bundleId: id,
        status: "pending",
        requestedBy: ctx.actorId,
        reason: body.reason ?? null,
        pricingAmountMinor: body.pricingAmountMinor,
        currency: body.currency,
        version: 1,
      });

      await enqueue(tx, {
        topic: EVENTS.bundleApprovalRequested,
        eventType: EVENTS.bundleApprovalRequested,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          approvalId,
          bundleId: id,
          requestedBy: ctx.actorId,
          // MONEY RULE: string in the jsonb payload so it stays JSON-safe and exact.
          pricingAmountMinor: body.pricingAmountMinor.toString(),
          currency: body.currency,
        },
      });
    });

    return reply.code(202).send({
      data: {
        id: approvalId,
        bundleId: id,
        status: "pending",
        pricingAmountMinor: body.pricingAmountMinor.toString(),
        currency: body.currency,
      },
    });
  });

  // ─── Decide an approval (maker-checker enforced) ─────────────────────────────
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

    // Separation of duties: the requester can never decide their own request.
    const maker = checkMakerChecker(approval.requestedBy, ctx.actorId);
    if (!maker.valid) {
      throw new HttpError(422, "MAKER_CHECKER_VIOLATION", "Maker-checker violation: the requester cannot decide their own bundle pricing approval");
    }

    if (body.decision === "rejected" && (body.reason === undefined || body.reason.trim().length < MIN_REASON_LENGTH)) {
      throw new HttpError(422, "REASON_REQUIRED", `A rejection reason of at least ${MIN_REASON_LENGTH} characters is required`);
    }

    const decidedAt = new Date();

    await db.transaction(async (tx) => {
      const ok = await approvalRepo.decideApproval(tx, approvalId, ctx.tenantId, {
        status: body.decision,
        decidedBy: ctx.actorId,
        decidedAt,
        approvedBy: body.decision === "approved" ? ctx.actorId : null,
        reason: body.reason ?? approval.reason,
      }, approval.version);
      if (!ok) throw new HttpError(409, "VERSION_CONFLICT", "Approval has been modified; retry with current state");

      await enqueue(tx, {
        topic: EVENTS.bundleApprovalDecided,
        eventType: EVENTS.bundleApprovalDecided,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          approvalId,
          bundleId: approval.bundleId,
          decision: body.decision,
          requestedBy: approval.requestedBy,
          decidedBy: ctx.actorId,
          decidedAt: decidedAt.toISOString(),
          ...(body.reason !== undefined ? { reason: body.reason } : {}),
          pricingAmountMinor: approval.pricingAmountMinor === null ? null : approval.pricingAmountMinor.toString(),
        },
      });
    });

    return reply.code(202).send({ data: { id: approvalId, status: body.decision, decidedBy: ctx.actorId } });
  });
}
