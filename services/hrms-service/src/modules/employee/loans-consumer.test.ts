/**
 * Wave 4 / cluster D regression tests — recording an EMI payment against a
 * loan that is no longer "active" is now rejected instead of silently
 * corrupting the loan's ledger.
 *
 * Before this fix, `loanEmiPaid` (see loans-consumer.ts) read the loan, then
 * ran an UPDATE whose WHERE clause checked only `id` — not tenantId, and
 * critically not status. A stray/duplicate payroll-deduction retry against
 * an already-"completed" (fully repaid) or "cancelled" loan would keep
 * decrementing outstandingMinor below zero (clamped to 0, so silent rather
 * than a visible negative) and bumping emisPaid past totalEmis, with no
 * error surfaced anywhere.
 *
 * Live-DB integration test — same reasoning as attendance/f3-consumer.test.ts:
 * employee.hrms_loans carries FORCE ROW LEVEL SECURITY, so every direct DB
 * access goes through runWithTenant(tenantId, () => db.transaction(tx => ...)),
 * and the consumer-driven write goes through a real queue wrapped the same
 * way production's queue-service does. hrms_loans.employee_id has an
 * ON DELETE RESTRICT FK to hrms_employees (migration 0124) — unlike
 * attendance's tables, cleanup must delete the loan row(s) before the
 * employee row or the FK rejects the delete.
 *
 * GAP-HR-ADVANCES-02 (added below): the new reject consumer, exercised the
 * same way (real MemoryQueue, real DB, read the row back afterward) --
 * `app.inject()`-based route tests (loans-advances-identity-and-reject-
 * real-db.test.ts) cannot observe this, since that harness's buildApp()
 * does not wire up registerLoanConsumers -- see that file's own comment.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { pgSchema, uuid, varchar, integer, bigint, timestamp, text, date } from "drizzle-orm/pg-core";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { hrmsEmployees } from "./schema.js";
import { registerLoanConsumers } from "./loans-consumer.js";
import { COMMANDS } from "../../topics.js";

// Mirrors the ad hoc local table definition already duplicated in both
// loans-routes.ts and loans-consumer.ts (this module has no shared
// employee/schema.ts entry for hrms_loans) — kept minimal/consistent with
// those rather than introducing a third, differently-shaped copy.
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
  rejectedBy: uuid("rejected_by"),
  rejectionReason: varchar("rejection_reason", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue({ maxAttempts: 1 });
  wireTenantAwareQueue(q);
  registerLoanConsumers(q);
  await q.start();
  return q;
}

interface Seeded {
  tenantId: string;
  employeeId: string;
  actorId: string;
}

async function seedEmployee(): Promise<Seeded> {
  const tenantId = randomUUID();
  const employeeId = randomUUID();
  const actorId = randomUUID();
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id: employeeId, tenantId,
      employeeNo: `LOAN-${employeeId.slice(0, 8)}`,
      fullName: "Loans Test Employee",
      departmentId: randomUUID(), designationId: randomUUID(),
      dateOfJoining: "2020-01-01", status: "confirmed",
      createdBy: actorId, updatedBy: actorId,
    });
  }));
  return { tenantId, employeeId, actorId };
}

async function cleanupEmployee(tenantId: string, employeeId: string): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    // fk_loans_employee_id is ON DELETE RESTRICT (migration 0124) — unlike
    // attendance's tables, the loan row(s) must go first or this delete
    // fails with a foreign-key violation.
    await tx.delete(hrmsLoans).where(eq(hrmsLoans.employeeId, employeeId));
    await tx.delete(hrmsSalaryAdvances).where(eq(hrmsSalaryAdvances.employeeId, employeeId));
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.id, employeeId));
  }));
}

interface LoanSeed {
  status: "active" | "completed" | "cancelled";
  emiMinor: bigint;
  totalEmis: number;
  emisPaid: number;
  outstandingMinor: bigint;
}

async function seedLoan(tenantId: string, employeeId: string, actorId: string, seed: LoanSeed): Promise<string> {
  const id = randomUUID();
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(hrmsLoans).values({
      id, tenantId, employeeId, loanType: "personal",
      sanctionedAmountMinor: seed.emiMinor * BigInt(seed.totalEmis),
      disbursedAmountMinor: seed.emiMinor * BigInt(seed.totalEmis),
      outstandingMinor: seed.outstandingMinor,
      emiMinor: seed.emiMinor, totalEmis: seed.totalEmis, emisPaid: seed.emisPaid,
      sanctionDate: "2025-01-01", status: seed.status, createdBy: actorId,
    });
  }));
  return id;
}

async function getLoan(tenantId: string, id: string) {
  return runWithTenant(tenantId, () => db.transaction(async (tx) => {
    const [row] = await tx.select().from(hrmsLoans).where(eq(hrmsLoans.id, id));
    return row;
  }));
}

async function seedAdvance(tenantId: string, employeeId: string, actorId: string, status: "pending" | "rejected" = "pending"): Promise<string> {
  const id = randomUUID();
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(hrmsSalaryAdvances).values({
      id, tenantId, employeeId, amountMinor: 500000n, purpose: "Medical",
      recoveryMonths: 6, emiMinor: 83334n, recoveredMinor: 0n,
      requestDate: "2026-01-15", status, createdBy: actorId,
    });
  }));
  return id;
}

async function getAdvance(tenantId: string, id: string) {
  return runWithTenant(tenantId, () => db.transaction(async (tx) => {
    const [row] = await tx.select().from(hrmsSalaryAdvances).where(eq(hrmsSalaryAdvances.id, id));
    return row;
  }));
}

async function publishEmiPaid(q: MemoryQueue, tenantId: string, actorId: string, loanId: string): Promise<void> {
  await q.publish(COMMANDS.loanEmiPaid, {
    messageId: randomUUID(), type: COMMANDS.loanEmiPaid,
    tenantId, actorId, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { id: loanId, tenantId },
  });
  await q.drain();
}

async function publishAdvanceReject(q: MemoryQueue, tenantId: string, actorId: string, advanceId: string, reason: string): Promise<void> {
  await q.publish(COMMANDS.salaryAdvanceReject, {
    messageId: randomUUID(), type: COMMANDS.salaryAdvanceReject,
    tenantId, actorId, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { id: advanceId, tenantId, reason },
  });
  await q.drain();
}

describe("EMI payment recording — no payment against a non-active loan", () => {
  it("recording an EMI payment against an already-completed (fully repaid) loan is a no-op, not a corrupted ledger", async () => {
    const { tenantId, employeeId, actorId } = await seedEmployee();
    try {
      const loanId = await seedLoan(tenantId, employeeId, actorId, {
        status: "completed", emiMinor: 500000n, totalEmis: 12, emisPaid: 12, outstandingMinor: 0n,
      });

      const q = await buildQueue();
      await publishEmiPaid(q, tenantId, actorId, loanId);

      // Before the fix: outstandingMinor would go to 0 again (clamped, so
      // the corruption was silent) and emisPaid would bump to 13 — past
      // totalEmis, on a loan already marked fully repaid. After the fix:
      // the guarded UPDATE's WHERE status='active' matches zero rows, so
      // the loan is untouched.
      const after = await getLoan(tenantId, loanId);
      expect(after?.status).toBe("completed");
      expect(after?.emisPaid).toBe(12);
      expect(after?.outstandingMinor).toBe(0n);
    } finally {
      await cleanupEmployee(tenantId, employeeId);
    }
  });

  it("recording an EMI payment against a cancelled loan is also a no-op", async () => {
    const { tenantId, employeeId, actorId } = await seedEmployee();
    try {
      const loanId = await seedLoan(tenantId, employeeId, actorId, {
        status: "cancelled", emiMinor: 200000n, totalEmis: 6, emisPaid: 2, outstandingMinor: 800000n,
      });

      const q = await buildQueue();
      await publishEmiPaid(q, tenantId, actorId, loanId);

      const after = await getLoan(tenantId, loanId);
      expect(after?.status).toBe("cancelled");
      expect(after?.emisPaid).toBe(2);
      expect(after?.outstandingMinor).toBe(800000n);
    } finally {
      await cleanupEmployee(tenantId, employeeId);
    }
  });

  it("recording an EMI payment against a genuinely active loan still works (guard doesn't block the legitimate case)", async () => {
    const { tenantId, employeeId, actorId } = await seedEmployee();
    try {
      const loanId = await seedLoan(tenantId, employeeId, actorId, {
        status: "active", emiMinor: 500000n, totalEmis: 12, emisPaid: 5, outstandingMinor: 3500000n,
      });

      const q = await buildQueue();
      await publishEmiPaid(q, tenantId, actorId, loanId);

      const after = await getLoan(tenantId, loanId);
      expect(after?.emisPaid).toBe(6);
      expect(after?.outstandingMinor).toBe(3000000n);
      expect(after?.status).toBe("active");
    } finally {
      await cleanupEmployee(tenantId, employeeId);
    }
  });
});

describe("GAP-HR-ADVANCES-02: salary advance reject consumer", () => {
  it("a pending advance is written to 'rejected' with rejectedBy/rejectionReason set", async () => {
    const { tenantId, employeeId, actorId } = await seedEmployee();
    const rejectorId = randomUUID();
    try {
      const advanceId = await seedAdvance(tenantId, employeeId, actorId, "pending");

      const q = await buildQueue();
      await publishAdvanceReject(q, tenantId, rejectorId, advanceId, "Exceeds monthly recovery cap");

      const after = await getAdvance(tenantId, advanceId);
      expect(after?.status).toBe("rejected");
      expect(after?.rejectedBy).toBe(rejectorId);
      expect(after?.rejectionReason).toBe("Exceeds monthly recovery cap");
    } finally {
      await cleanupEmployee(tenantId, employeeId);
    }
  });

  it("an already-rejected advance is left untouched by a second reject (status-guard, no double-write)", async () => {
    const { tenantId, employeeId, actorId } = await seedEmployee();
    try {
      const advanceId = await seedAdvance(tenantId, employeeId, actorId, "rejected");

      const q = await buildQueue();
      await publishAdvanceReject(q, tenantId, randomUUID(), advanceId, "Second attempt");

      const after = await getAdvance(tenantId, advanceId);
      // Still "rejected" from the original seed, and NOT overwritten with
      // the second attempt's reason -- the guarded UPDATE's WHERE
      // status='pending' matched zero rows.
      expect(after?.status).toBe("rejected");
      expect(after?.rejectionReason).toBeNull();
    } finally {
      await cleanupEmployee(tenantId, employeeId);
    }
  });
});
