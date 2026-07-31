/**
 * Custom Employee Type Master — tenants can define ANY employee category.
 *
 * Instead of a hardcoded enum, each tenant manages their own types:
 * "Permanent", "Contract", "Intern", "Visiting Faculty", "Fellow",
 * "Part-time", "Apprentice", "Volunteer", etc.
 *
 * Each type carries metadata: whether they get leave, whether they run through
 * payroll, what their default probation period is, etc.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { pgSchema, uuid, varchar, integer, timestamp, boolean } from "drizzle-orm/pg-core";

const HR_ROLES = ["hr_admin", "super_admin", "admin"];

const employeeSchema = pgSchema("employee");
const employeeTypeMaster = employeeSchema.table("hrms_employee_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  code: varchar("code", { length: 24 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  description: varchar("description", { length: 500 }),
  // Configuration flags
  eligibleForLeave: boolean("eligible_for_leave").notNull().default(true),
  eligibleForPayroll: boolean("eligible_for_payroll").notNull().default(true),
  eligibleForAppraisal: boolean("eligible_for_appraisal").notNull().default(true),
  defaultProbationMonths: integer("default_probation_months").notNull().default(0),
  maxContractMonths: integer("max_contract_months"),  // null = unlimited
  payMode: varchar("pay_mode", { length: 16 }).notNull().default("monthly"), // monthly|hourly|consolidated|stipend|none
  // Engagement policy pack (migration 0065) — drives pay/statutory/tax/leave per type.
  category: varchar("category", { length: 24 }).notNull().default("other"), // pay_scale|contractual|consultant|third_party|apprentice|other
  paymentRoute: varchar("payment_route", { length: 16 }).notNull().default("payroll"), // payroll|invoice|agency|stipend|none
  taxSection: varchar("tax_section", { length: 8 }).notNull().default("192"), // 192|194J|194C|stipend|none
  statutoryPf: boolean("statutory_pf").notNull().default(true),
  statutoryEsi: boolean("statutory_esi").notNull().default(true),
  statutoryNps: boolean("statutory_nps").notNull().default(true),
  eligibleForGratuity: boolean("eligible_for_gratuity").notNull().default(true),
  eligibleForBonus: boolean("eligible_for_bonus").notNull().default(false),
  leaveEncashment: boolean("leave_encashment").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});

const createBody = z.object({
  code: z.string().min(1).max(24),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  eligibleForLeave: z.boolean().default(true),
  eligibleForPayroll: z.boolean().default(true),
  eligibleForAppraisal: z.boolean().default(true),
  defaultProbationMonths: z.number().int().nonnegative().default(0),
  maxContractMonths: z.number().int().positive().optional(),
  payMode: z.enum(["monthly", "hourly", "consolidated", "stipend", "none"]).default("monthly"),
  category: z.enum(["pay_scale", "contractual", "consultant", "third_party", "apprentice", "other"]).default("other"),
  paymentRoute: z.enum(["payroll", "invoice", "agency", "stipend", "none"]).default("payroll"),
  taxSection: z.enum(["192", "194J", "194C", "stipend", "none"]).default("192"),
  // Permissive defaults: an unset flag means "full benefit". An admin sets the
  // restrictive flags they want (e.g. a consultant type → eligibleForPayroll:false).
  statutoryPf: z.boolean().default(true),
  statutoryEsi: z.boolean().default(true),
  statutoryNps: z.boolean().default(true),
  eligibleForGratuity: z.boolean().default(true),
  eligibleForBonus: z.boolean().default(false),
  leaveEncashment: z.boolean().default(true),
  sortOrder: z.number().int().nonnegative().default(0),
});

export async function employeeTypeRoutes(app: FastifyInstance): Promise<void> {
  // List all employee types for this tenant
  app.get("/v1/hrms/employee-types", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "manager", "officer"]);
    const rows = await scopedRead((tx) => tx.select().from(employeeTypeMaster).where(eq(employeeTypeMaster.tenantId, ctx.tenantId)));
    return reply.send({ data: rows });
  });

  // Create a new employee type
  app.post("/v1/hrms/employee-types", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createBody.parse(req.body);
    const id = randomUUID();
    await db.transaction((tx) => tx.insert(employeeTypeMaster).values({
      id, tenantId: ctx.tenantId, ...body,
      description: body.description ?? null,
      maxContractMonths: body.maxContractMonths ?? null,
      createdBy: ctx.actorId,
    }).onConflictDoNothing());
    return reply.code(201).send({ id, status: "created" });
  });

  // Update an employee type
  app.patch("/v1/hrms/employee-types/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = createBody.partial().parse(req.body);
    const patch: Record<string, unknown> = {};
    if (body.code !== undefined) patch.code = body.code;
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description ?? null;
    if (body.eligibleForLeave !== undefined) patch.eligibleForLeave = body.eligibleForLeave;
    if (body.eligibleForPayroll !== undefined) patch.eligibleForPayroll = body.eligibleForPayroll;
    if (body.eligibleForAppraisal !== undefined) patch.eligibleForAppraisal = body.eligibleForAppraisal;
    if (body.defaultProbationMonths !== undefined) patch.defaultProbationMonths = body.defaultProbationMonths;
    if (body.maxContractMonths !== undefined) patch.maxContractMonths = body.maxContractMonths;
    if (body.payMode !== undefined) patch.payMode = body.payMode;
    if (body.category !== undefined) patch.category = body.category;
    if (body.paymentRoute !== undefined) patch.paymentRoute = body.paymentRoute;
    if (body.taxSection !== undefined) patch.taxSection = body.taxSection;
    if (body.statutoryPf !== undefined) patch.statutoryPf = body.statutoryPf;
    if (body.statutoryEsi !== undefined) patch.statutoryEsi = body.statutoryEsi;
    if (body.statutoryNps !== undefined) patch.statutoryNps = body.statutoryNps;
    if (body.eligibleForGratuity !== undefined) patch.eligibleForGratuity = body.eligibleForGratuity;
    if (body.eligibleForBonus !== undefined) patch.eligibleForBonus = body.eligibleForBonus;
    if (body.leaveEncashment !== undefined) patch.leaveEncashment = body.leaveEncashment;
    if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder;
    await db.transaction((tx) => tx.update(employeeTypeMaster).set(patch as any).where(eq(employeeTypeMaster.id, id)));
    return reply.send({ id, status: "updated" });
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
