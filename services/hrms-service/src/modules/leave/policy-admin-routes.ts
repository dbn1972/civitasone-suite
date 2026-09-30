import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Leave Policy Admin Routes — HR Admin can configure leave rules per employee type
 * This is the "input box" for configuring different policies for:
 * - Permanent (Govt)
 * - Contractual
 * - Vendor-deputed (outsourced staff from vendors)
 * - Deputation
 * - Consultant
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and } from "drizzle-orm";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsLeavePolicyRules } from "./policy-schema.js";
import { hrmsLeaveTypes } from "./schema.js";

/**
 * GAP-HR-LEAVE-POLICIES-01/02: mirrors the web's
 * apps/web/src/lib/auth/workRoles.ts LEAVE_POLICY_ADMIN_ROLES exactly — keep
 * both in sync. "admin" was dropped (not a role this system ever issues —
 * see that constant's doc comment for the full re-derivation from the
 * Keycloak realm/packages/auth role catalogue); tenant_admin/platform_admin
 * were added (already admitted by hr/layout.tsx's HR_ROLES, so denying them
 * here was a dead end, not a real boundary). hr_officer is deliberately not
 * included — widening leave-entitlement admin to it needs HR sign-off.
 */
const HR_ADMIN_ROLES = ["hr_admin", "super_admin", "tenant_admin", "platform_admin"];

const employeeTypeEnum = z.enum(["permanent", "contractual", "vendor_deputed", "deputation", "consultant", "temporary", "intern", "apprentice", "volunteer"]);
const countMethodEnum = z.enum(["calendar", "working_days"]);

const createPolicyBody = z.object({
  leaveTypeId: z.string().uuid(),
  employeeType: employeeTypeEnum,
  maxDaysPerYear: z.number().int().min(0).max(730),
  carryForward: z.boolean().default(false),
  maxAccumulation: z.number().int().min(0).default(0),
  encashable: z.boolean().default(false),
  countMethod: countMethodEnum.default("calendar"),
  maxContinuousDays: z.number().int().min(1).max(730).default(365),
  minServiceMonths: z.number().int().min(0).default(0),
  genderRestriction: z.enum(["male", "female"]).nullable().default(null),
  requiresMedicalCert: z.boolean().default(false),
  requiresMedicalCertAfterDays: z.number().int().min(1).default(3),
  prefixSuffixRule: z.boolean().default(false),
  sandwichRule: z.boolean().default(false),
  proRataOnJoining: z.boolean().default(true),
});

// GAP-HR-LEAVE-POLICIES-04: a policy could be deactivated (DELETE, below)
// but never reactivated — updatePolicyBody had no isActive field at all, so
// the only way back to isActive:true was re-POSTing the same
// leaveType+employeeType (upsert semantics in f3-consumer.ts). The consumer
// already applies `{...body, ...}` verbatim on update, so adding the field
// here is sufficient — no consumer change needed.
const updatePolicyBody = createPolicyBody.partial().omit({ leaveTypeId: true, employeeType: true }).extend({
  isActive: z.boolean().optional(),
});

export async function policyAdminRoutes(app: FastifyInstance): Promise<void> {
  // ── List all leave policies for this tenant (filterable by employee type) ──
  app.get("/v1/hrms/admin/leave-policies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ADMIN_ROLES);
    const q = z.object({ employeeType: employeeTypeEnum.optional() }).parse(req.query);

    const { rows, types } = await scopedRead(async (tx) => {
      const policyRows = await (q.employeeType
        ? tx.select().from(hrmsLeavePolicyRules).where(and(eq(hrmsLeavePolicyRules.tenantId, ctx.tenantId), eq(hrmsLeavePolicyRules.employeeType, q.employeeType)))
        : tx.select().from(hrmsLeavePolicyRules).where(eq(hrmsLeavePolicyRules.tenantId, ctx.tenantId))
      );

      // Join with leave type names
      const typeRows = await tx.select().from(hrmsLeaveTypes).where(eq(hrmsLeaveTypes.tenantId, ctx.tenantId));
      return { rows: policyRows, types: typeRows };
    });
    const typeMap = new Map(types.map(t => [t.id, { code: t.code, name: t.name }]));

    return reply.send({
      data: rows.map(r => ({
        id: r.id,
        leaveTypeId: r.leaveTypeId,
        leaveTypeCode: typeMap.get(r.leaveTypeId)?.code ?? "?",
        leaveTypeName: typeMap.get(r.leaveTypeId)?.name ?? "?",
        employeeType: r.employeeType,
        maxDaysPerYear: r.maxDaysPerYear,
        carryForward: r.carryForward,
        maxAccumulation: r.maxAccumulation,
        encashable: r.encashable,
        countMethod: r.countMethod,
        maxContinuousDays: r.maxContinuousDays,
        minServiceMonths: r.minServiceMonths,
        genderRestriction: r.genderRestriction,
        requiresMedicalCert: r.requiresMedicalCert,
        requiresMedicalCertAfterDays: r.requiresMedicalCertAfterDays,
        prefixSuffixRule: r.prefixSuffixRule,
        sandwichRule: r.sandwichRule,
        proRataOnJoining: r.proRataOnJoining,
        isActive: r.isActive,
      })),
    });
  });

  // ── Create a new leave policy rule ──
  app.post("/v1/hrms/admin/leave-policies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ADMIN_ROLES);
    const body = createPolicyBody.parse(req.body);
    const id = randomUUID();

    // GAP-HR-LEAVE-POLICIES-03: this is a queued write (publishF3Write —
    // applied later by f3-consumer.ts's leave_policy_admin_routes__0 case),
    // but used to reply 201 "created" as if it had already happened
    // (CLAUDE.md requires 202 for async writes). The client's immediate
    // refetch could then show the pre-write list under a "created" toast.
    // publishF3Write already returns exactly the {id,status:"accepted",
    // correlationId} shape acceptedResponseSchema expects.
    //
    // Forward the PARSED `body` (Zod defaults applied — carryForward,
    // maxAccumulation, countMethod, etc. all have .default(...)), not raw
    // req.body: the pre-existing code built a whole `upsertValues` object
    // from `body` here but then never actually used it (publishF3Write only
    // ever saw raw req.body), so an omitted optional field's default was
    // silently lost between validation and the queued write.
    const result = await publishF3Write(ctx, "leave_policy_admin_routes__0", id, { body: body as unknown as Record<string, unknown>, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return sendAccepted(reply, acceptedResponseSchema, result);
  });

  // ── Update an existing policy rule ──
  app.patch("/v1/hrms/admin/leave-policies/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = updatePolicyBody.parse(req.body);

    // GAP-HR-LEAVE-POLICIES-03: same 200-"updated"-for-a-queued-write issue
    // as POST above — the client's toast/refetch could precede the actual
    // write and briefly show stale values under a "Policy updated" toast.
    // Forwards the parsed `body` (see the POST handler's comment above for
    // why, not raw req.body).
    const result = await publishF3Write(ctx, "leave_policy_admin_routes__1", id, { body: body as unknown as Record<string, unknown>, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return sendAccepted(reply, acceptedResponseSchema, result);
  });

  // ── Deactivate a policy rule (soft delete: isActive=false) ──
  app.delete("/v1/hrms/admin/leave-policies/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    // GAP-HR-LEAVE-POLICIES-04: this had no caller in the web app before
    // this PR added one (LeavePoliciesClient's Deactivate action). Answering
    // 202 (not 204) from the start, consistent with the other two queued
    // writes above, rather than implying the deactivation is already visible.
    const result = await publishF3Write(ctx, "leave_policy_admin_routes__2", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return sendAccepted(reply, acceptedResponseSchema, result);
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
