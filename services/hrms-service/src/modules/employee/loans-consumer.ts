import type { Queue } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { pgSchema, uuid, varchar, integer, bigint, timestamp, text, date } from "drizzle-orm/pg-core";

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

export function registerLoanConsumers(q: Queue): void {
  q.subscribe(COMMANDS.loanCreate, async (msg) => {
    const p = msg.payload as Record<string, any>;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(hrmsLoans).values({
        id: p.id, tenantId: p.tenantId, employeeId: p.employeeId, loanType: p.loanType,
        sanctionedAmountMinor: BigInt(p.sanctionedAmountMinor),
        disbursedAmountMinor: BigInt(p.sanctionedAmountMinor),
        outstandingMinor: BigInt(p.sanctionedAmountMinor),
        interestRateBps: p.interestRateBps, emiMinor: BigInt(p.emiMinor),
        totalEmis: p.totalEmis, emisPaid: 0, sanctionDate: p.sanctionDate,
        firstEmiDate: p.firstEmiDate ?? null, purpose: p.purpose ?? null,
        status: "active", createdBy: msg.actorId,
      });
    });
  });
  q.subscribe(COMMANDS.loanEmiPaid, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const [loan] = await tx.select().from(hrmsLoans).where(and(eq(hrmsLoans.id, p.id), eq(hrmsLoans.tenantId, p.tenantId)));
      if (!loan) return;
      const newOutstanding = loan.outstandingMinor - loan.emiMinor;
      const newPaid = loan.emisPaid + 1;
      const newStatus = newOutstanding <= 0n ? "completed" : "active";
      await tx.update(hrmsLoans).set({
        outstandingMinor: newOutstanding < 0n ? 0n : newOutstanding,
        emisPaid: newPaid, status: newStatus,
      }).where(eq(hrmsLoans.id, p.id));
    });
  });
  q.subscribe(COMMANDS.salaryAdvanceCreate, async (msg) => {
    const p = msg.payload as Record<string, any>;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(hrmsSalaryAdvances).values({
        id: p.id, tenantId: p.tenantId, employeeId: p.employeeId,
        amountMinor: BigInt(p.amountMinor), purpose: p.purpose,
        recoveryMonths: p.recoveryMonths, emiMinor: BigInt(p.emiMinor),
        recoveredMinor: 0n, requestDate: p.requestDate, status: "pending", createdBy: msg.actorId,
      });
    });
  });
  q.subscribe(COMMANDS.salaryAdvanceApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.update(hrmsSalaryAdvances).set({ status: "active", approvedBy: msg.actorId })
        .where(and(eq(hrmsSalaryAdvances.id, p.id), eq(hrmsSalaryAdvances.tenantId, p.tenantId)));
    });
  });
}
