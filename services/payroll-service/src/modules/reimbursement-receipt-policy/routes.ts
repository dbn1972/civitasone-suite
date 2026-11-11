import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import {
  REIMBURSEMENT_CATEGORY_CODES, RECEIPT_MODES, effectiveReceiptRule, describeReceiptRule, receiptPolicyIssue,
  type ReceiptPolicy,
} from "@civitasone/types";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { loadReceiptPolicy, receiptPolicySchema } from "./repo.js";
import * as commands from "./commands.js";

/** Mirrors world-class-routes.ts ROLES: everyone who can file or list claims may READ the rule (the form needs it). */
const READ_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "employee"];
/** Changing it: payroll admin / super admin only. */
const ADMIN_ROLES = ["payroll_admin", "super_admin"];

const updateBodySchema = z.object({
  categories: receiptPolicySchema.shape.categories,
  /** Recorded on the audit event; the web ConfirmDialog always sends it (min 10 chars). */
  reason: z.string().trim().min(10).max(500).optional(),
}).strict();

export async function receiptPolicyRoutes(app: FastifyInstance): Promise<void> {
  /** The rule in force for every category (explicit or default), plus the raw saved overrides. */
  app.get("/v1/payroll/reimbursement-receipt-policy", async (req, reply) => {
    void reply.header("cache-control", "no-store");
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const stored = await loadReceiptPolicy(ctx.tenantId);
    return {
      isDefault: stored.isDefault,
      updatedAt: stored.updatedAt,
      modes: RECEIPT_MODES,
      categories: Object.fromEntries(REIMBURSEMENT_CATEGORY_CODES.map((c) => {
        const rule = effectiveReceiptRule(stored.policy, c);
        return [c, { mode: rule.mode, thresholdMinor: rule.thresholdMinor ?? null, selfDeclarationUpToMinor: rule.selfDeclarationUpToMinor ?? null, description: describeReceiptRule(rule) }];
      })),
    };
  });

  /** Change the rule (admin only). CQRS: publishes a command; the consumer writes + audits. */
  app.put("/v1/payroll/reimbursement-receipt-policy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = updateBodySchema.parse(req.body);
    const policy = { categories: body.categories } as ReceiptPolicy;
    const issue = receiptPolicyIssue(policy);
    if (issue) throw new HttpError(422, "RECEIPT_POLICY_INVALID", `${issue.path}: ${issue.message}`);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateReceiptPolicy(ctx, { policy, reason: body.reason ?? null }));
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof z.ZodError) {
      void reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    if (err instanceof HttpError) {
      void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
      return;
    }
    req.log.error({ err }, "unhandled error");
    void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
