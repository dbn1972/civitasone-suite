/**
 * Quotation approval workflow routes (QP-004).
 *  - PUT  /v1/crm/quotation-approvals/thresholds     configure the discount policy
 *  - POST /v1/crm/quotations/:id/approvals           request an approval (exception)
 *  - GET  /v1/crm/quotations/:id/approvals           list approvals for a quotation
 *  - POST /v1/crm/quotation-approvals/:id/decide     approve / reject
 *
 * The send-gate (unapproved exceptions cannot be issued as final) lives in
 * quotations-routes.ts, which calls hasBlockingApproval() before publishing a send.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { commandId } from "../../shared/idempotency.js";
import { queue } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";
import { COMMANDS } from "../../topics.js";
import { APPROVAL_TYPES, initialStatus, breachSnapshot, effectiveDiscountBps } from "./quotation-approval-domain.js";
import * as repo from "./quotation-approval-repo.js";
import { canApprove, resolveApprovalAuthority, type AuthorityResolution } from "../discounts/domain.js";
import * as discountRepo from "../discounts/repo.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

const idParam = z.object({ id: z.string().uuid() });

const thresholdBody = z.object({
  approvalType: z.enum(APPROVAL_TYPES),
  maxDiscountBps: z.number().int().min(0).max(10000),
  requiresRole: z.string().min(1).max(64).default("crm_admin"),
  enabled: z.boolean().default(true),
});

const requestBody = z.object({
  approvalType: z.enum(APPROVAL_TYPES),
  discountBps: z.number().int().min(0).max(1000000),
  reason: z.string().max(2000).optional(),
});

const decideBody = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().max(2000).optional(),
});

/** UTC today as YYYY-MM-DD — the calendar day the delegation chain is resolved as at. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * G26: the delegation-of-authority columns to record on the approval row.
 *
 * `applied_limit_bps` is a SNAPSHOT rather than a join to the live limit: the limits are
 * effective-dated and a later card supersedes them, so "what authority was exercised here"
 * cannot be recomputed after the fact. The audit question is about the past.
 */
function delegationFields(r: AuthorityResolution | null): {
  appliedLimitId: string | null;
  appliedLimitBps: number | null;
  requiredApproverRole: string | null;
  requiredApproverLevel: number | null;
  authorityOutcome: string | null;
} {
  if (r === null) {
    return { appliedLimitId: null, appliedLimitBps: null, requiredApproverRole: null, requiredApproverLevel: null, authorityOutcome: null };
  }
  return {
    appliedLimitId: r.approverLimit?.id ?? null,
    appliedLimitBps: r.approverLimit?.maxDiscountBps ?? null,
    requiredApproverRole: r.requiredRole,
    requiredApproverLevel: r.requiredLevel,
    authorityOutcome: r.outcome,
  };
}

async function quotationExists(tenantId: string, id: string): Promise<boolean> {
  const rows = await scopedRead(async (tx) => tx.execute(sql`
    SELECT 1 AS ok FROM crm.quotations WHERE id = ${id} AND tenant_id = ${tenantId} LIMIT 1
  `)) as unknown as Array<{ ok: number }>;
  return rows.length > 0;
}

export async function quotationApprovalRoutes(app: FastifyInstance): Promise<void> {
  app.put("/v1/crm/quotation-approvals/thresholds", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = thresholdBody.parse(req.body);
    const msgId = commandId(ctx, `${COMMANDS.upsertApprovalThreshold}:${body.approvalType}`);
    await queue.publish(COMMANDS.upsertApprovalThreshold, {
      messageId: msgId, type: COMMANDS.upsertApprovalThreshold, tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { tenantId: ctx.tenantId, ...body },
    });
    return reply.code(202).send({ id: msgId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/crm/quotations/:id/approvals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = requestBody.parse(req.body);
    if (!(await quotationExists(ctx.tenantId, id))) throw new HttpError(404, "NOT_FOUND", "quotation not found");

    // For a discount, the authoritative level is DERIVED from the quotation'\''s line
    // prices vs catalogue reference — the client'\''s discountBps is advisory only, so a
    // rep cannot request `discountBps: 0` to auto-approve a genuinely deep discount.
    let effective = body.discountBps;
    if (body.approvalType === "discount") {
      effective = effectiveDiscountBps(await repo.referenceLines(ctx.tenantId, id));
    }
    const threshold = await repo.getThreshold(ctx.tenantId, body.approvalType);

    /**
     * G26 — the DELEGATION LIMIT decides, not a flat threshold.
     *
     * The requester's own authority (the most generous limit among the roles they hold, in
     * force today) is compared to the server-derived discount. Within it, the request is
     * auto-approved and the limit that permitted it is recorded. Above it, the request is
     * routed to the lowest-level limit that both covers the discount and OUTRANKS the
     * requester, so a peer cannot sign off a colleague's exception.
     *
     * This does not fork the approval flow: it is the same crm.quotation_approvals ledger,
     * the same commands and the same send-gate. Only the initial status and the recorded
     * authority change. When the tenant has configured no limits in force
     * (`outcome: 'no_policy'`) the pre-G26 threshold rule still decides, so a tenant that
     * has not adopted G26 sees no behaviour change at all.
     */
    const asAt = today();
    let authority: AuthorityResolution | null = null;
    let status: string;
    if (body.approvalType === "discount") {
      const chain = await discountRepo.delegationChain(ctx.tenantId);
      const resolved = resolveApprovalAuthority(effective, { roles: ctx.roles }, chain, asAt);
      if (resolved.outcome === "no_policy") {
        status = initialStatus(effective, threshold);
      } else {
        authority = resolved;
        status = resolved.outcome === "auto_approved" ? "approved" : "pending";
      }
    } else {
      status = initialStatus(effective, threshold);
    }

    const snapshot = breachSnapshot(body.approvalType, effective, threshold, body.discountBps);
    // A fresh id per request (commandId is random without an idempotency key) so a new
    // request supersedes an earlier decision instead of colliding with it (MEDIUM-4).
    const approvalId = commandId(ctx, `${COMMANDS.requestQuotationApproval}:${id}:${body.approvalType}`);
    const delegation = delegationFields(authority);

    await queue.publish(COMMANDS.requestQuotationApproval, {
      messageId: approvalId, type: COMMANDS.requestQuotationApproval, tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: {
        id: approvalId, tenantId: ctx.tenantId, quotationId: id, approvalType: body.approvalType,
        status, thresholdBreached: snapshot, reason: body.reason ?? null, requestedBy: ctx.actorId,
        ...delegation,
      },
    });
    return reply.code(202).send({
      id: approvalId,
      status: "accepted",
      approvalStatus: status,
      // Surfaced so the caller knows WHO must sign off rather than only that someone must.
      authorityOutcome: delegation.authorityOutcome,
      requiredApproverRole: delegation.requiredApproverRole,
      requiredApproverLevel: delegation.requiredApproverLevel,
      correlationId: ctx.correlationId,
    });
  });

  app.get("/v1/crm/quotations/:id/approvals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await repo.listApprovals(ctx.tenantId, id);
    return reply.send({ data: rows });
  });

  app.post("/v1/crm/quotation-approvals/:id/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = decideBody.parse(req.body);
    const approval = await repo.findApproval(ctx.tenantId, id);
    if (!approval) throw new HttpError(404, "NOT_FOUND", "approval not found");
    if (approval.status !== "pending") throw new HttpError(422, "ALREADY_DECIDED", `approval is already ${approval.status}`);

    /**
     * G26 — the approver must actually hold the delegated authority.
     *
     * Checked against the SAME crm.delegation_limits chain the request was routed by, not
     * against `required_approver_role` copied onto the row: a role name on a row is a label,
     * and a caller who happens to hold that label may since have had their limit reduced.
     * Only an APPROVE is gated — declining an exception needs no delegated spending
     * authority, and blocking a rejection would leave a request nobody senior enough is
     * available to close.
     */
    if (body.decision === "approve" && approval.approvalType === "discount" && approval.authorityOutcome !== null) {
      const requested = approval.appliedRequestBps ?? 0;
      const chain = await discountRepo.delegationChain(ctx.tenantId);
      if (!canApprove(ctx.roles, requested, chain, today())) {
        throw new HttpError(
          403,
          "INSUFFICIENT_DELEGATION",
          `approving a ${requested} bps discount exceeds your delegated authority`,
          { requiredApproverRole: approval.requiredApproverRole, requiredApproverLevel: approval.requiredApproverLevel },
        );
      }
    }

    const msgId = commandId(ctx, `${COMMANDS.decideQuotationApproval}:${id}`);
    await queue.publish(COMMANDS.decideQuotationApproval, {
      messageId: msgId, type: COMMANDS.decideQuotationApproval, tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, decision: body.decision, reason: body.reason ?? null, approver: ctx.actorId, expectedVersion: approval.version },
    });
    return reply.code(202).send({ id: msgId, status: "accepted", correlationId: ctx.correlationId });
  });
}
