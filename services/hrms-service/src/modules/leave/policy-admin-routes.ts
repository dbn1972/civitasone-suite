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
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsLeavePolicyRules } from "./policy-schema.js";
import { hrmsLeaveTypes } from "./schema.js";

const HR_ADMIN_ROLES = ["hr_admin", "super_admin", "admin"];

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

const updatePolicyBody = createPolicyBody.partial().omit({ leaveTypeId: true, employeeType: true });

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

    const upsertValues = {
      id,
      tenantId: ctx.tenantId,
      leaveTypeId: body.leaveTypeId,
      employeeType: body.employeeType,
      maxDaysPerYear: body.maxDaysPerYear,
      carryForward: body.carryForward,
      maxAccumulation: body.maxAccumulation,
      encashable: body.encashable,
      countMethod: body.countMethod,
      maxContinuousDays: body.maxContinuousDays,
      minServiceMonths: body.minServiceMonths,
      genderRestriction: body.genderRestriction,
      requiresMedicalCert: body.requiresMedicalCert,
      requiresMedicalCertAfterDays: body.requiresMedicalCertAfterDays,
      prefixSuffixRule: body.prefixSuffixRule,
      sandwichRule: body.sandwichRule,
      proRataOnJoining: body.proRataOnJoining,
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
    };

    const result = await publishF3Write(ctx, "leave_policy_admin_routes__0", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> }) as any

    const returnedId = result[0]?.id ?? id;
    return reply.code(201).send({ id: returnedId, status: "created", employeeType: body.employeeType, leaveTypeId: body.leaveTypeId });
  });

  // ── Update an existing policy rule ──
  app.patch("/v1/hrms/admin/leave-policies/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = updatePolicyBody.parse(req.body);

    await publishF3Write(ctx, "leave_policy_admin_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })

    return reply.send({ id, status: "updated" }) as any;
  });

  // ── Delete (soft: deactivate) a policy rule ──
  app.delete("/v1/hrms/admin/leave-policies/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    await publishF3Write(ctx, "leave_policy_admin_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })

    return reply.code(204).send() as any;
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
