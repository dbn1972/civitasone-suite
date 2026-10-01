/**
 * Employee Loans & Salary Advances — full CRUD.
 * Handles: HBA, Motor Car, Computer, Festival, Personal loans + salary advances.
 * EMI recovery is fed into payroll via the LOAN_EMI component code.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RequestContext } from "@civitasone/types";
import { z, ZodError } from "zod";
import { eq, and, inArray } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import * as loanCommands from "./loans-commands.js";
import { pgSchema, uuid, varchar, integer, bigint, timestamp, text, date } from "drizzle-orm/pg-core";
import { hrmsEmployees } from "./schema.js";
import { resolveEmployeeForActor } from "./actor-link.js";
import { batchEmployees, batchDepartments } from "../../shared/batch-resolve.js";

// "hr_officer" is treated as an HR-tier role everywhere else in this codebase
// (medical/routes.ts, employee/routes.ts both fold it into their own
// HR_ROLES) -- this file was the one place it was left out of HR_ROLES and
// instead bundled into the generic ALL_ROLES tail below, which is why it
// ended up with zero-filter tenant-wide access alongside manager/officer.
// Folded in here to match the rest of the codebase; ALL_ROLES membership
// (who may call these routes at all) is unchanged.
const HR_ROLES = ["hr_admin", "finance_admin", "super_admin", "hr_officer"];
const ALL_ROLES = [...HR_ROLES, "manager", "officer"];

// GAP-HR-ADVANCES-03 (decision packet theme 3, recommended default: "Turn on
// self-service -- amount and employee id always resolved server-side from
// the logged-in session, never accepted from the client"): salary advances
// (unlike loans, which stay HR-created only -- see GAP-HR-LOANS-05's empty
// copy) admit a plain "employee" caller, scoped to their own record only.
// Kept as its own list (not folded into ALL_ROLES above) so loans' GET/POST
// are untouched -- widening the shared ALL_ROLES would also open GET/POST
// /v1/hrms/loans to "employee", which nothing in this campaign's catalog or
// decision packet asked for.
const ADVANCE_ROLES = [...ALL_ROLES, "employee"];

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
async function resolveManagerScope(ctx: RequestContext, _req: FastifyRequest): Promise<string | null | undefined> {
  const isHrActor = HR_ROLES.some((r) => ctx.roles.includes(r));
  if (isHrActor) return undefined;
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  return actorEmp?.id ?? null;
}

/** The hrms_employees.id set reporting directly to `managerId` (hrmsEmployees.managerId), tenant-scoped. */
async function directReportIds(tenantId: string, managerId: string): Promise<string[]> {
  const rows = await scopedRead((tx) => tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.tenantId, tenantId), eq(hrmsEmployees.managerId, managerId))));
  return rows.map((r) => r.id);
}

/**
 * GAP-HR-ADVANCES-03 read/write scope for the salary-advances routes only.
 * Unlike resolveManagerScope above (which treats every non-HR caller as a
 * manager, scoped to direct reports), a bare "employee" role is not a
 * manager of anyone -- directReportIds(tenantId, self) would return their
 * OWN reports (empty, for almost everyone), not their own advances. This
 * distinguishes the three cases explicitly:
 *  - "all"     caller holds an HR_ROLES role -- unrestricted, tenant-wide.
 *  - "reports" caller holds manager/officer -- restrict to direct reports.
 *  - "self"    caller holds only "employee" -- restrict to their own row.
 *  - "denied"  no resolvable hrms_employees link -- fail CLOSED.
 */
type AdvanceScope =
  | { kind: "all" }
  | { kind: "reports"; managerId: string }
  | { kind: "self"; employeeId: string }
  | { kind: "denied" };

async function resolveAdvanceScope(ctx: RequestContext): Promise<AdvanceScope> {
  const isHrActor = HR_ROLES.some((r) => ctx.roles.includes(r));
  if (isHrActor) return { kind: "all" };
  const isManagerActor = ctx.roles.includes("manager") || ctx.roles.includes("officer");
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  if (!actorEmp) return { kind: "denied" };
  if (isManagerActor) return { kind: "reports", managerId: actorEmp.id };
  return { kind: "self", employeeId: actorEmp.id };
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
  // GAP-HR-ADVANCES-02: reject was previously impossible -- no columns to
  // record who rejected an advance or why. Nullable/additive: existing rows
  // are unaffected, only ever set by the new reject route below.
  rejectedBy: uuid("rejected_by"),
  rejectionReason: varchar("rejection_reason", { length: 500 }),
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
  // GAP-HR-ADVANCES-03: optional, not required -- a self-service "employee"
  // caller's form hides the employee picker entirely and sends no
  // employeeId at all (the server derives it below); HR/manager/officer
  // still name whom they're filing for, and that path enforces employeeId
  // is actually present (see the handler below). Never trust this field
  // for authorization even when present -- it's re-checked against the
  // caller's own scope every time.
  employeeId: z.string().uuid().optional(),
  amountMinor: z.number().int().positive(),
  purpose: z.string().min(2).max(200),
  recoveryMonths: z.number().int().min(1).max(12).default(1),
  requestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const loansExportAuditBody = z.object({
  rowCount: z.number().int().min(0).max(1_000_000),
  filter: z.string().max(200).optional(),
});

const rejectAdvanceBody = z.object({
  reason: z.string().min(1).max(500),
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
    // GAP-HR-LOANS-01: the web page (loans/page.tsx) has expected
    // employeeName/department on each row for a while -- mapLoans() already
    // falls back to the raw UUID / "--" when they're absent, which is
    // exactly what every row did, since this handler never actually sent
    // them. Reuses the shared GAP-HR-SF-17 batch-resolution helper (no
    // cross-module schema import -- goes through employee/repo.ts's own
    // findManyByIds), the same building block GAP-HR-ADVANCES-01 below and
    // lifecycle/routes.ts already use.
    const empMap = await batchEmployees(ctx.tenantId, rows.map((r) => r.employeeId));
    const deptMap = await batchDepartments(ctx.tenantId, [...empMap.values()].map((e) => e.departmentId));
    return reply.send({ data: rows.map((r) => ({
      ...r,
      sanctionedAmountMinor: Number(r.sanctionedAmountMinor),
      disbursedAmountMinor: Number(r.disbursedAmountMinor),
      outstandingMinor: Number(r.outstandingMinor),
      emiMinor: Number(r.emiMinor),
      employeeName: empMap.get(r.employeeId)?.fullName,
      employeeNo: empMap.get(r.employeeId)?.employeeNo,
      department: deptMap.get(empMap.get(r.employeeId)?.departmentId ?? ""),
    })) });
  });

  // GAP-HR-LOANS-02: the web CSV export (HR roles only) reports each export
  // here so it lands on the audit trail -- the file carries employee identity
  // plus financial data. HR_ROLES matches the roles the Export button is shown to.
  app.post("/v1/hrms/loans/export-audit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = loansExportAuditBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await loanCommands.recordLoansExport(ctx, body.rowCount, body.filter));
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
    requireRole(ctx, ADVANCE_ROLES);
    const scope = await resolveAdvanceScope(ctx);
    if (scope.kind === "denied") return reply.send({ data: [] });
    let idFilter: string[] | undefined;
    if (scope.kind === "self") {
      idFilter = [scope.employeeId];
    } else if (scope.kind === "reports") {
      idFilter = await directReportIds(ctx.tenantId, scope.managerId);
      if (idFilter.length === 0) return reply.send({ data: [] });
    }
    const rows = await scopedRead((tx) => tx.select().from(hrmsSalaryAdvances).where(and(
      eq(hrmsSalaryAdvances.tenantId, ctx.tenantId),
      ...(idFilter ? [inArray(hrmsSalaryAdvances.employeeId, idFilter)] : []),
    )));
    // GAP-HR-ADVANCES-01: same shared batch-resolution helper as GET
    // /v1/hrms/loans above -- the web mapAdvances() falls back to the raw
    // UUID whenever employeeName is absent, which was every row.
    const empMap = await batchEmployees(ctx.tenantId, rows.map((r) => r.employeeId));
    return reply.send({ data: rows.map((r) => ({
      ...r,
      amountMinor: Number(r.amountMinor),
      emiMinor: Number(r.emiMinor),
      recoveredMinor: Number(r.recoveredMinor),
      employeeName: empMap.get(r.employeeId)?.fullName,
      employeeNo: empMap.get(r.employeeId)?.employeeNo,
    })) });
  });

  app.post("/v1/hrms/salary-advances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADVANCE_ROLES);
    const body = createAdvanceBody.parse(req.body);

    // IDOR fix: the UI's employee picker fetches every employee in the
    // tenant, letting any manager/officer submit an advance request naming
    // an arbitrary co-worker's employeeId -- zero ownership check existed
    // (body.employeeId was inserted raw by the consumer). HR/finance roles
    // stay unrestricted. manager/officer may only name one of their own
    // direct reports. GAP-HR-ADVANCES-03: a bare "employee" caller's
    // employeeId is IGNORED entirely and forced to their own linked
    // hrms_employees row -- the client can send anything (or omit it) and
    // it is never trusted for this role, matching the decision packet's
    // "amount and employee id always resolved server-side" default.
    const scope = await resolveAdvanceScope(ctx);
    let employeeId: string;
    if (scope.kind === "denied") {
      throw new HttpError(403, "FORBIDDEN", "no linked employee record for this account");
    } else if (scope.kind === "self") {
      // Self-service: the client sends no employeeId at all (the form hides
      // the picker entirely) -- whatever it sent, if anything, is ignored.
      employeeId = scope.employeeId;
    } else {
      // HR ("all") or manager/officer ("reports"): employeeId is required --
      // this is the "file on behalf of" path, so there must be a target.
      if (!body.employeeId) {
        throw new HttpError(400, "VALIDATION_FAILED", "employeeId is required");
      }
      if (scope.kind === "reports") {
        const reportIds = await directReportIds(ctx.tenantId, scope.managerId);
        if (!reportIds.includes(body.employeeId)) {
          throw new HttpError(403, "FORBIDDEN", "you may only request an advance for your own direct reports");
        }
      }
      employeeId = body.employeeId;
    }

    const emi = Math.ceil(body.amountMinor / body.recoveryMonths);
    return sendAccepted(reply, acceptedResponseSchema, await loanCommands.createAdvance(ctx, {
      ...body, employeeId, emiMinor: emi, requestDate: body.requestDate ?? new Date().toISOString().slice(0, 10),
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
    if (advance.status !== "pending") {
      throw new HttpError(404, "NOT_FOUND", "salary advance not found or already decided");
    }
    if (advance.createdBy === ctx.actorId) {
      throw new HttpError(403, "FORBIDDEN", "you may not approve a salary advance you created yourself");
    }

    return sendAccepted(reply, acceptedResponseSchema, await loanCommands.approveAdvance(ctx, id));
  });

  // Reject advance (GAP-HR-ADVANCES-02: this route did not exist at all --
  // the page's "Rejected" stat card had no way to ever become non-zero).
  // Mirrors the approve route's pending-status + maker-checker guards
  // exactly, so a rejection is held to the same standard as an approval.
  app.patch("/v1/hrms/salary-advances/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = rejectAdvanceBody.parse(req.body);

    const rows = await scopedRead((tx) => tx.select({ id: hrmsSalaryAdvances.id, status: hrmsSalaryAdvances.status, createdBy: hrmsSalaryAdvances.createdBy })
      .from(hrmsSalaryAdvances)
      .where(and(eq(hrmsSalaryAdvances.id, id), eq(hrmsSalaryAdvances.tenantId, ctx.tenantId)))
      .limit(1));
    const advance = rows[0];
    if (!advance) throw new HttpError(404, "NOT_FOUND", "salary advance not found");
    if (advance.status !== "pending") {
      throw new HttpError(404, "NOT_FOUND", "salary advance not found or already decided");
    }
    if (advance.createdBy === ctx.actorId) {
      throw new HttpError(403, "FORBIDDEN", "you may not reject a salary advance you created yourself");
    }

    return sendAccepted(reply, acceptedResponseSchema, await loanCommands.rejectAdvance(ctx, id, body.reason));
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
