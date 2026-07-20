/**
 * Employee Loans & Salary Advances — full CRUD.
 * Handles: HBA, Motor Car, Computer, Festival, Personal loans + salary advances.
 * EMI recovery is fed into payroll via the LOAN_EMI component code.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { resolveContext, requireRole } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { pgSchema, uuid, varchar, integer, bigint, timestamp, text, date } from "drizzle-orm/pg-core";

const HR_ROLES = ["hr_admin", "finance_admin", "super_admin"];
const ALL_ROLES = [...HR_ROLES, "manager", "officer", "hr_officer"];

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
    const rows = await scopedRead((tx) => tx.select().from(hrmsLoans).where(eq(hrmsLoans.tenantId, ctx.tenantId)));
    return reply.send({ data: rows.map(r => ({ ...r, sanctionedAmountMinor: Number(r.sanctionedAmountMinor), disbursedAmountMinor: Number(r.disbursedAmountMinor), outstandingMinor: Number(r.outstandingMinor), emiMinor: Number(r.emiMinor) })) });
  });

  app.post("/v1/hrms/loans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createLoanBody.parse(req.body);
    const id = randomUUID();
    const emi = Math.ceil(body.sanctionedAmountMinor / body.totalEmis);
    await db.transaction((tx) => tx.insert(hrmsLoans).values({
      id, tenantId: ctx.tenantId, employeeId: body.employeeId,
      loanType: body.loanType,
      sanctionedAmountMinor: BigInt(body.sanctionedAmountMinor),
      disbursedAmountMinor: BigInt(body.sanctionedAmountMinor),
      outstandingMinor: BigInt(body.sanctionedAmountMinor),
      interestRateBps: body.interestRateBps,
      emiMinor: BigInt(emi),
      totalEmis: body.totalEmis, emisPaid: 0,
      sanctionDate: body.sanctionDate,
      firstEmiDate: body.firstEmiDate ?? null,
      purpose: body.purpose ?? null,
      status: "active", createdBy: ctx.actorId,
    }));
    return reply.code(201).send({ id, status: "created", emiMinor: emi });
  });

  // Record EMI payment (called by payroll after deduction)
  app.patch("/v1/hrms/loans/:id/emi-paid", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const loan = (await scopedRead((tx) => tx.select().from(hrmsLoans).where(and(eq(hrmsLoans.id, id), eq(hrmsLoans.tenantId, ctx.tenantId)))))[0];
    if (!loan) return reply.code(404).send({ code: "NOT_FOUND", message: "loan not found" });
    const newOutstanding = loan.outstandingMinor - loan.emiMinor;
    const newPaid = loan.emisPaid + 1;
    const newStatus = newOutstanding <= 0n ? "completed" : "active";
    await db.transaction((tx) => tx.update(hrmsLoans).set({ outstandingMinor: newOutstanding < 0n ? 0n : newOutstanding, emisPaid: newPaid, status: newStatus }).where(eq(hrmsLoans.id, id)));
    return reply.send({ id, emisPaid: newPaid, outstandingMinor: Number(newOutstanding < 0n ? 0n : newOutstanding), status: newStatus });
  });

  // ── SALARY ADVANCES ──

  app.get("/v1/hrms/salary-advances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(hrmsSalaryAdvances).where(eq(hrmsSalaryAdvances.tenantId, ctx.tenantId)));
    return reply.send({ data: rows.map(r => ({ ...r, amountMinor: Number(r.amountMinor), emiMinor: Number(r.emiMinor), recoveredMinor: Number(r.recoveredMinor) })) });
  });

  app.post("/v1/hrms/salary-advances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const body = createAdvanceBody.parse(req.body);
    const id = randomUUID();
    const emi = Math.ceil(body.amountMinor / body.recoveryMonths);
    await db.transaction((tx) => tx.insert(hrmsSalaryAdvances).values({
      id, tenantId: ctx.tenantId, employeeId: body.employeeId,
      amountMinor: BigInt(body.amountMinor),
      purpose: body.purpose,
      recoveryMonths: body.recoveryMonths,
      emiMinor: BigInt(emi),
      recoveredMinor: 0n,
      requestDate: body.requestDate ?? new Date().toISOString().slice(0, 10),
      status: "pending", createdBy: ctx.actorId,
    }));
    return reply.code(201).send({ id, status: "pending", emiMinor: emi });
  });

  // Approve advance
  app.patch("/v1/hrms/salary-advances/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await db.transaction((tx) => tx.update(hrmsSalaryAdvances).set({ status: "active", approvedBy: ctx.actorId }).where(and(eq(hrmsSalaryAdvances.id, id), eq(hrmsSalaryAdvances.tenantId, ctx.tenantId))));
    return reply.send({ id, status: "approved" });
  });
}
