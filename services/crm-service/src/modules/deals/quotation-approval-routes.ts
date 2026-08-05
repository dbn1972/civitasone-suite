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
    const status = initialStatus(effective, threshold);
    const snapshot = breachSnapshot(body.approvalType, effective, threshold, body.discountBps);
    // A fresh id per request (commandId is random without an idempotency key) so a new
    // request supersedes an earlier decision instead of colliding with it (MEDIUM-4).
    const approvalId = commandId(ctx, `${COMMANDS.requestQuotationApproval}:${id}:${body.approvalType}`);

    await queue.publish(COMMANDS.requestQuotationApproval, {
      messageId: approvalId, type: COMMANDS.requestQuotationApproval, tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: {
        id: approvalId, tenantId: ctx.tenantId, quotationId: id, approvalType: body.approvalType,
        status, thresholdBreached: snapshot, reason: body.reason ?? null, requestedBy: ctx.actorId,
      },
    });
    return reply.code(202).send({ id: approvalId, status: "accepted", approvalStatus: status, correlationId: ctx.correlationId });
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

    const msgId = commandId(ctx, `${COMMANDS.decideQuotationApproval}:${id}`);
    await queue.publish(COMMANDS.decideQuotationApproval, {
      messageId: msgId, type: COMMANDS.decideQuotationApproval, tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, decision: body.decision, reason: body.reason ?? null, approver: ctx.actorId, expectedVersion: approval.version },
    });
    return reply.code(202).send({ id: msgId, status: "accepted", correlationId: ctx.correlationId });
  });
}
