/**
 * Employee Loans & Salary Advances — full CRUD.
 * Handles: HBA, Motor Car, Computer, Festival, Personal loans + salary advances.
 * EMI recovery is fed into payroll via the LOAN_EMI component code.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RequestContext } from "@civitasone/types";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { eq, and, inArray } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import * as loanCommands from "./loans-commands.js";
import { pgSchema, uuid, varchar, integer, bigint, timestamp, text, date } from "drizzle-orm/pg-core";
import { hrmsEmployees } from "./schema.js";
import { resolveEmployeeForActor, extractActorEmail } from "./actor-link.js";

// "hr_officer" is treated as an HR-tier role everywhere else in this codebase
// (medical/routes.ts, employee/routes.ts both fold it into their own
// HR_ROLES) -- this file was the one place it was left out of HR_ROLES and
// instead bundled into the generic ALL_ROLES tail below, which is why it
// ended up with zero-filter tenant-wide access alongside manager/officer.
// Folded in here to match the rest of the codebase; ALL_ROLES membership
// (who may call these routes at all) is unchanged.
const HR_ROLES = ["hr_admin", "finance_admin", "super_admin", "hr_officer"];
const ALL_ROLES = [...HR_ROLES, "manager", "officer"];

/**
 * SEC finding: GET /v1/hrms/loans and GET /v1/hrms/salary-advances gave
 * every ALL_ROLES-holding caller an unfiltered, tenant-wide dump -- manager
 * and officer (not HR/finance) had zero per-employee or per-report scoping.
 *
 * Resolves the caller's OWN hrms_employees row via resolveEmployeeForActor
 * (userRef = actorId, email fallback) -- same primitive and same shape as
 * employee/routes.ts's resolveManagerScope (this file doesn't import that
 * one directly: it's a private, non-exported helper there, and every module
 * in this service that needs this defines its own local copy -- medical/
 * routes.ts's resolveSelfScopedEmployeeId does the same).
 *
 * Returns:
 *  - undefined  caller holds an HR_ROLES role -- unrestricted, tenant-wide.
 *  - a string   caller is manager/officer-only, linked to this hrms_employees
 *               row -- restrict to direct reports of this id.
 *  - null       caller is manager/officer-only with NO resolvable employee
 *               link -- fail CLOSED (empty results), never tenant-wide.
 */
async function resolveManagerScope(ctx: RequestContext, req: FastifyRequest): Promise<string | null | undefined> {
  const isHrActor = HR_ROLES.some((r) => ctx.roles.includes(r));
  if (isHrActor) return undefined;
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId, extractActorEmail(req));
  return actorEmp?.id ?? null;
}

/** The hrms_employees.id set reporting directly to `managerId` (hrmsEmployees.managerId), tenant-scoped. */
async function directReportIds(tenantId: string, managerId: string): Promise<string[]> {
  const rows = await scopedRead((tx) => tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.tenantId, tenantId), eq(hrmsEmployees.managerId, managerId))));
  return rows.map((r) => r.id);
}

const employeeSchema = pgSchema("employee");

const hrmsLoans = employeeSchema.table("hrms_loans", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  loanType: varchar("loan_type", { length: 32 }).notNull(),
  sanctionedAmountMinor: bigint("sanctioned_amount_minor", { mode: "bigint" }).notNull().default(0n),
  disbursedAmountMinor: bigint("disbursed_amount_minor", { mode: "bigint" }).notNull().default(0n),
  outstandingMinor: bigint("outstanding_minor", { mode: "bigint" }).notNull().default(0n),
  interestRateBps: integer("interest_rate_bps").notNull().default(0),
  emiMinor: bigint("emi_minor", { mode: "bigint" }).notNull().default(0n),
  totalEmis: integer("total_emis").notNull().default(0),
  emisPaid: integer("emis_paid").notNull().default(0),
  sanctionDate: date("sanction_date").notNull(),
  firstEmiDate: date("first_emi_date"),
  lastEmiDate: date("last_emi_date"),
  purpose: text("purpose"),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});

const hrmsSalaryAdvances = employeeSchema.table("hrms_salary_advances", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  purpose: varchar("purpose", { length: 200 }).notNull(),
  recoveryMonths: integer("recovery_months").notNull().default(1),
  emiMinor: bigint("emi_minor", { mode: "bigint" }).notNull().default(0n),
  recoveredMinor: bigint("recovered_minor", { mode: "bigint" }).notNull().default(0n),
  requestDate: date("request_date").notNull(),
  approvedBy: uuid("approved_by"),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});

const LOAN_TYPES = ["hba", "motor_car", "computer", "festival", "personal", "medical", "other"] as const;

const createLoanBody = z.object({
  employeeId: z.string().uuid(),
  loanType: z.enum(LOAN_TYPES),
  sanctionedAmountMinor: z.number().int().positive(),
  interestRateBps: z.number().int().nonnegative().default(0),
  totalEmis: z.number().int().positive().max(360),
  sanctionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  firstEmiDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  purpose: z.string().max(500).optional(),
});

const createAdvanceBody = z.object({
  employeeId: z.string().uuid(),
  amountMinor: z.number().int().positive(),
  purpose: z.string().min(2).max(200),
  recoveryMonths: z.number().int().min(1).max(12).default(1),
  requestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function loansRoutes(app: FastifyInstance): Promise<void> {
  // ── LOANS ──

  app.get("/v1/hrms/loans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const managerScope = await resolveManagerScope(ctx, req);
    if (managerScope === null) return reply.send({ data: [] });
    const reportIds = managerScope === undefined ? undefined : await directReportIds(ctx.tenantId, managerScope);
    if (reportIds && reportIds.length === 0) return reply.send({ data: [] });
    const rows = await scopedRead((tx) => tx.select().from(hrmsLoans).where(and(
      eq(hrmsLoans.tenantId, ctx.tenantId),
      ...(reportIds ? [inArray(hrmsLoans.employeeId, reportIds)] : []),
    )));
    return reply.send({ data: rows.map(r => ({ ...r, sanctionedAmountMinor: Number(r.sanctionedAmountMinor), disbursedAmountMinor: Number(r.disbursedAmountMinor), outstandingMinor: Number(r.outstandingMinor), emiMinor: Number(r.emiMinor) })) });
  });

  app.post("/v1/hrms/loans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createLoanBody.parse(req.body);
    const emi = Math.ceil(body.sanctionedAmountMinor / body.totalEmis);
    return sendAccepted(reply, acceptedResponseSchema, await loanCommands.createLoan(ctx, { ...body, emiMinor: emi }));
  });

  // Record EMI payment (called by payroll after deduction)
  app.patch("/v1/hrms/loans/:id/emi-paid", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const loan = (await scopedRead((tx) => tx.select().from(hrmsLoans).where(and(eq(hrmsLoans.id, id), eq(hrmsLoans.tenantId, ctx.tenantId)))))[0];
    if (!loan) return reply.code(404).send({ code: "NOT_FOUND", message: "loan not found" });
    // Status-guard fix: recording an EMI payment against a loan that is no
    // longer "active" (already fully repaid -- "completed" -- or any other
    // terminal status) used to succeed with no check at all: the async
    // consumer (loans-consumer.ts) would keep decrementing an
    // already-zeroed outstandingMinor and bumping emisPaid past totalEmis
    // on every stray/duplicate payroll-deduction retry. Synchronous
    // pre-check mirroring attendance/routes.ts's regularisation and
    // overtime approve/reject guards: fail fast with a clear 409 instead of
    // a false 202 that the consumer's own status-guarded UPDATE would then
    // silently no-op.
    if (loan.status !== "active") {
      throw new HttpError(409, "LOAN_NOT_ACTIVE", `cannot record an EMI payment against loan ${id}: status is "${loan.status}", not "active"`);
    }
    return sendAccepted(reply, acceptedResponseSchema, await loanCommands.recordEmiPaid(ctx, id));
  });

  // ── SALARY ADVANCES ──

  app.get("/v1/hrms/salary-advances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const managerScope = await resolveManagerScope(ctx, req);
    if (managerScope === null) return reply.send({ data: [] });
    const reportIds = managerScope === undefined ? undefined : await directReportIds(ctx.tenantId, managerScope);
    if (reportIds && reportIds.length === 0) return reply.send({ data: [] });
    const rows = await scopedRead((tx) => tx.select().from(hrmsSalaryAdvances).where(and(
      eq(hrmsSalaryAdvances.tenantId, ctx.tenantId),
      ...(reportIds ? [inArray(hrmsSalaryAdvances.employeeId, reportIds)] : []),
    )));
    return reply.send({ data: rows.map(r => ({ ...r, amountMinor: Number(r.amountMinor), emiMinor: Number(r.emiMinor), recoveredMinor: Number(r.recoveredMinor) })) });
  });

  app.post("/v1/hrms/salary-advances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const body = createAdvanceBody.parse(req.body);

    // IDOR fix: the UI's employee picker fetches every employee in the
    // tenant, letting any manager/officer submit an advance request naming
    // an arbitrary co-worker's employeeId -- zero ownership check existed
    // (body.employeeId was inserted raw by the consumer). HR/finance roles
    // stay unrestricted (HR-assisted requests on behalf of any employee is
    // the only way this endpoint is reachable for a bare "employee" role
    // today -- "employee" is not in ALL_ROLES above, so there is no
    // self-service caller to force onto their own id yet). manager/officer
    // may only name one of their own direct reports, mirroring the list
    // routes' scoping above rather than inventing a second shape.
    const managerScope = await resolveManagerScope(ctx, req);
    if (managerScope !== undefined) {
      if (managerScope === null) {
        throw new HttpError(403, "FORBIDDEN", "no linked employee record for this account");
      }
      const reportIds = await directReportIds(ctx.tenantId, managerScope);
      if (!reportIds.includes(body.employeeId)) {
        throw new HttpError(403, "FORBIDDEN", "you may only request an advance for your own direct reports");
      }
    }

    const emi = Math.ceil(body.amountMinor / body.recoveryMonths);
    return sendAccepted(reply, acceptedResponseSchema, await loanCommands.createAdvance(ctx, {
      ...body, emiMinor: emi, requestDate: body.requestDate ?? new Date().toISOString().slice(0, 10),
    }));
  });

  // Approve advance
  app.patch("/v1/hrms/salary-advances/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    // Maker-checker fix: HR_ROLES membership alone let the SAME hr_admin who
    // filed an advance also approve it. createdBy is set from ctx.actorId at
    // creation (loans-consumer.ts) -- the JWT-subject id space, so a direct
    // comparison against ctx.actorId here is correct (unlike employeeId
    // above, which is a different id space and needs resolveEmployeeForActor).
    // Synchronous pre-check, mirroring the coi-routes revoke/acknowledge
    // precedent, so a rejected approval doesn't 202 as if it went through.
    const rows = await scopedRead((tx) => tx.select({ id: hrmsSalaryAdvances.id, status: hrmsSalaryAdvances.status, createdBy: hrmsSalaryAdvances.createdBy })
      .from(hrmsSalaryAdvances)
      .where(and(eq(hrmsSalaryAdvances.id, id), eq(hrmsSalaryAdvances.tenantId, ctx.tenantId)))
      .limit(1));
    const advance = rows[0];
    if (!advance) throw new HttpError(404, "NOT_FOUND", "salary advance not found");
    if (advance.createdBy === ctx.actorId) {
      throw new HttpError(403, "FORBIDDEN", "you may not approve a salary advance you created yourself");
    }

    return sendAccepted(reply, acceptedResponseSchema, await loanCommands.approveAdvance(ctx, id));
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
