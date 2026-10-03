import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, financeErrorHandler } from "../../shared/context.js";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import * as workflow from "./vendor-workflow.js";
import * as commands from "./vendor-commands.js";
import { getPolicy, listPendingPolicyChanges } from "./policy.js";

// Same split as masters/routes.ts: vendor master is system-of-record data, so
// the approval and bank-change decisions are finance_admin / super_admin only.
const WRITER_ROLES = ["finance_admin", "super_admin"];
const READER_ROLES = ["finance_officer", "finance_admin", "super_admin", "audit_officer"];
/** Who may reveal masked vendor PII (PAN, account number, phone, email). Every reveal is audited with its reason. */
export const VENDOR_PII_REVEAL_ROLES = ["finance_officer", "finance_admin", "accounts_officer", "super_admin"];
/** Who may export the vendor register. Every export is audited. */
export const VENDOR_EXPORT_ROLES = ["finance_officer", "finance_admin", "accounts_officer", "super_admin"];

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const idParam = z.object({ id: z.string().uuid() });
const changeParam = z.object({ id: z.string().uuid(), changeId: z.string().uuid() });

// approve / reject are bound to the vendor version the checker reviewed (stale -> 409 VERSION_CONFLICT)
const decideOpt = z.object({ version: z.number().int().min(1), reason: z.string().trim().min(5).max(500).optional() });
const decideReq = z.object({ version: z.number().int().min(1), reason: z.string().trim().min(5).max(500) });
const reasonOpt = z.object({ reason: z.string().trim().min(5).max(500).optional() });
const reasonReq = z.object({ reason: z.string().trim().min(5).max(500) });
const changeIdParam = z.object({ changeId: z.string().uuid() });
const revealBody = z.object({
  fields: z.array(z.enum(["pan", "bankAccount", "phone", "email"])).min(1).max(4),
  reason: z.string().trim().min(5).max(300),
});
const bankChangeBody = z.object({
  bankName: z.string().trim().min(2).max(200),
  bankAccount: z.string().trim().min(5).max(30),
  ifsc: z.string().length(11).transform((v) => v.toUpperCase()).refine((v) => IFSC_RE.test(v), "invalid IFSC format"),
  reason: z.string().trim().min(5).max(500),
});
const policyBody = z.object({
  vendorMakerChecker: z.boolean().optional(),
  auditParaMakerChecker: z.boolean().optional(),
  chequeValidityMonths: z.number().int().min(1).max(12).optional(),
}).refine((b) => Object.keys(b).length > 0, "no policy field supplied");

export async function vendorWorkflowRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/finance/vendors/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = decideOpt.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.requestVendorDecision(ctx, id, "approve", body.reason, body.version));
  });

  app.post("/v1/finance/vendors/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = decideReq.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.requestVendorDecision(ctx, id, "reject", body.reason, body.version));
  });

  app.post("/v1/finance/vendors/:id/reveal", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VENDOR_PII_REVEAL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = revealBody.parse(req.body);
    const values = await workflow.revealVendorFields(ctx, id, body.fields, body.reason);
    reply.header("cache-control", "no-store");
    return reply.send({ values });
  });

  // Server-authoritative export: audited BEFORE the data is released, CSV built from the masked shape.
  app.post("/v1/finance/vendors/export", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VENDOR_EXPORT_ROLES);
    const out = await workflow.exportVendorRegister(ctx);
    reply.header("cache-control", "no-store");
    return reply.send(out);
  });

  app.post("/v1/finance/vendors/:id/bank-change", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = bankChangeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.requestBankChangePropose(ctx, id, body));
  });

  app.post("/v1/finance/vendors/:id/bank-change/:changeId/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITER_ROLES);
    const { id, changeId } = changeParam.parse(req.params);
    const body = reasonOpt.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.requestBankChangeDecision(ctx, id, changeId, "approve", body.reason));
  });

  app.post("/v1/finance/vendors/:id/bank-change/:changeId/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITER_ROLES);
    const { id, changeId } = changeParam.parse(req.params);
    const body = reasonReq.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.requestBankChangeDecision(ctx, id, changeId, "reject", body.reason));
  });

  app.get("/v1/finance/policy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    return reply.send(await getPolicy(ctx.tenantId));
  });

  // Tightening applies at once; loosening (a maker != checker switch OFF, validity above the RBI 3 months) becomes a
  // pending request a DIFFERENT admin must approve. The 202 says which (`requiresApproval`).
  app.put("/v1/finance/policy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITER_ROLES);
    const body = policyBody.parse(req.body);
    const out = await commands.requestPolicyChange(ctx, body);
    return reply.code(202).send({ data: { id: out.id, status: out.status, correlationId: out.correlationId, requiresApproval: out.requiresApproval, changeId: out.changeId } });
  });

  app.get("/v1/finance/policy/changes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = await listPendingPolicyChanges(ctx.tenantId);
    return reply.send({ data: rows.map((c) => ({ id: c.id, patch: c.patch, proposedBy: c.proposedBy, proposedAt: c.proposedAt, status: c.status })) });
  });

  app.post("/v1/finance/policy/changes/:changeId/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITER_ROLES);
    const { changeId } = changeIdParam.parse(req.params);
    const body = reasonOpt.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.requestPolicyChangeDecision(ctx, changeId, "approve", body.reason));
  });

  app.post("/v1/finance/policy/changes/:changeId/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITER_ROLES);
    const { changeId } = changeIdParam.parse(req.params);
    const body = reasonReq.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.requestPolicyChangeDecision(ctx, changeId, "reject", body.reason));
  });

  app.setErrorHandler(financeErrorHandler);
}
