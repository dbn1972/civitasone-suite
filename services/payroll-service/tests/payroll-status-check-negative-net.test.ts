/**
 * CRITICAL regression test — payroll_slips_status_check /
 * payroll_runs_status_check(_extended) reconciliation (migration 0047).
 *
 * Before the fix: an employee whose fixed (non-recovery) deductions exceed
 * gross gets, in consumer.ts, status: negativeNet ? "exception" : "computed"
 * (both computeAndInsertSlip and the pensioner insert path) — but migration
 * 0027's payroll_slips_status_check only allowed
 * ('computed','approved','paid','held'). That INSERT throws INSIDE
 * processPayrollRun's transaction, aborting every other employee's
 * already-computed slip in the same run along with it, and the outer catch
 * in registerPayrollConsumers's runCreate handler marks the WHOLE run
 * 'failed', with last_error (migration 0046) containing the literal
 * Postgres constraint-violation message. Real payrolls routinely have
 * employees with heavy loan/court-order/LOP deductions, so this is not an
 * edge case.
 *
 * This seeds one normal employee and one employee with a heavy, non-recovery
 * fixed structure deduction (domain.ts's RECOVERY_CODES — LOP, LOAN_EMI,
 * ARREAR_RECOVERY — are floor-protected and deferred instead of going
 * negative; a plain structure-defined deduction like a court-ordered
 * recovery is NOT) big enough to push net pay negative for them alone, in
 * the SAME run, and asserts the run completes without reaching 'failed',
 * with that one slip flagged 'exception' while the other employee's slip
 * computes normally.
 *
 * A second test exercises payroll_runs_status_check_extended directly for
 * 'computed'/'paid'/'cancelled' — these are allowed by the extended
 * constraint's evident intent but (grep-verified against the whole repo)
 * have no application-level writer/transition wired yet, so the only way to
 * verify the CONSTRAINT itself no longer blocks them is a direct update.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { eq, sql } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { payrollRuns, payrollSlips, payrollStructures, payrollComponents } from "../src/modules/payroll/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";

const ACTOR      = "00000000-aaaa-4000-8000-0000000000f1";
const TENANT     = "11111111-aaaa-4000-8000-0000000000f1";
const STRUCT     = "22222222-aaaa-4000-8000-0000000000f1";
const RUN_ID     = "33333333-aaaa-4000-8000-0000000000f1";
const MSG_ID     = "44444444-aaaa-4000-8000-0000000000f1";
const EMP_NORMAL = "55555555-aaaa-4000-8000-0000000000f1";
const EMP_HEAVY  = "66666666-aaaa-4000-8000-0000000000f1";
const DEPT       = "77777777-aaaa-4000-8000-0000000000f1";

// consumer.ts imports only fetchPayrollInput from hrms-client.js; no HRMS
// service runs in this isolated stack, so it is stubbed to hand back one
// normal employee and one whose basic is too small to absorb the heavy
// fixed deduction seeded onto the shared structure below. Mirrors the
// vi.mock("../src/shared/hrms-client.js", ...) pattern used throughout this
// suite (e.g. world-class-cqrs.test.ts, integration-payroll-finance.test.ts).
vi.mock("../src/shared/hrms-client.js", () => ({
  fetchPayrollInput: vi.fn(async () => ({
    month: "2026-09",
    employees: [
      {
        id: EMP_NORMAL, employeeNo: "EMP-NORMAL-1", fullName: "Normal Employee",
        basicMinor: "3000000", dateOfJoining: "2020-01-01", payStructureId: STRUCT,
        bankAccountNo: null, bankIfsc: null, pan: null, uan: null,
        cityClass: "X", taxRegime: "new", departmentId: DEPT, pensionScheme: "EPF",
      },
      {
        id: EMP_HEAVY, employeeNo: "EMP-HEAVY-1", fullName: "Heavy Deduction Employee",
        basicMinor: "800000", dateOfJoining: "2020-01-01", payStructureId: STRUCT,
        bankAccountNo: null, bankIfsc: null, pan: null, uan: null,
        cityClass: "X", taxRegime: "new", departmentId: DEPT, pensionScheme: "EPF",
      },
    ],
    lopDays: {},
    overtimeHours: {},
  })),
}));

const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

async function wipeTestData() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(payrollSlips).where(eq(payrollSlips.tenantId, TENANT));
    await tx.delete(payrollRuns).where(eq(payrollRuns.tenantId, TENANT));
    await tx.delete(payrollComponents).where(eq(payrollComponents.tenantId, TENANT));
    await tx.delete(payrollStructures).where(eq(payrollStructures.tenantId, TENANT));
    // Seeded below (beforeAll) so processPayrollRun's now-mandatory DA-rate
    // check (DA_RATE_NOT_CONFIGURED) doesn't reject this run -- deleted here
    // too so re-running this suite against a persistent (non-wiped) test
    // database doesn't hit dearness_allowance_rates' unique
    // (tenant_id, effective_from) constraint on the next beforeAll insert.
    await tx.execute(sql`DELETE FROM payroll.dearness_allowance_rates WHERE tenant_id = ${TENANT}::uuid`);
    await tx.delete(processed).where(eq(processed.messageId, MSG_ID));
  }));
}

describe("payroll_slips / payroll_runs status CHECK constraints (migration 0047)", () => {
  beforeAll(async () => {
    await wipeTestData();
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(payrollStructures).values({
        id: STRUCT, tenantId: TENANT, name: "Test Structure", isDefault: true,
        status: "active", createdBy: ACTOR, updatedBy: ACTOR,
      });
      // Heavy, non-recovery fixed deduction: RECOVERY_CODES only exempts
      // LOP/LOAN_EMI/ARREAR_RECOVERY from this; any other structure-defined
      // deduction (e.g. a court order) is NOT floor-protected by design (see
      // domain.ts computeSlip's nonRecovery/negativeNet split). ₹20,000
      // exceeds EMP_HEAVY's ~₹8,000+HRA gross but not EMP_NORMAL's ~₹30,000+HRA.
      await tx.insert(payrollComponents).values({
        id: randomUUID(), tenantId: TENANT, structureId: STRUCT,
        code: "COURT_ORDER", name: "Court-Ordered Recovery", componentType: "deduction",
        fixedMinor: 2_000_000n, createdBy: ACTOR, updatedBy: ACTOR,
      });
      // This test is about the status CHECK constraint, not DA -- but
      // resolveDaRateBps now rejects a run whose tenant/period has no DA
      // rate configured at all (see consumer.ts's DA_RATE_NOT_CONFIGURED
      // fix), so a rate must be seeded for the run to reach the negative-net
      // path this test actually exercises.
      await tx.execute(sql`
        INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps)
        VALUES (${TENANT}::uuid, '2026-01-01'::date, 5000)
      `);
    }));
  });

  afterAll(async () => {
    await wipeTestData();
    await sqlClient.end();
  });

  it("a heavy-deduction employee's slip is 'exception' and the rest of the run computes normally — the run does not fail", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerPayrollConsumers(q);
    await q.start();

    await q.publish("payroll.run.create", {
      messageId: MSG_ID, type: "payroll.run.create",
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-neg-net-1", schemaVersion: "1.0",
      payload: {
        id: RUN_ID, tenantId: TENANT, runNo: "RUN-NEGNET-001", month: "2026-09",
        structureId: STRUCT, status: "draft",
      },
    });

    await new Promise<void>((r) => setTimeout(r, 2000));
    await q.stop();

    const runs = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(payrollRuns).where(eq(payrollRuns.id, RUN_ID))));
    expect(runs).toHaveLength(1);
    // The core regression: before the fix this was 'failed', with last_error
    // containing payroll_slips_status_check's violation message.
    expect(runs[0]?.lastError).toBeNull();
    expect(runs[0]?.status).not.toBe("failed");

    const slips = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(payrollSlips).where(eq(payrollSlips.runId, RUN_ID))));
    expect(slips).toHaveLength(2);

    const heavySlip = slips.find((s) => s.employeeId === EMP_HEAVY);
    const normalSlip = slips.find((s) => s.employeeId === EMP_NORMAL);
    expect(heavySlip?.status).toBe("exception");
    expect(heavySlip?.netPayMinor).toBeLessThanOrEqual(0n);
    expect(normalSlip?.status).toBe("computed");
    expect(normalSlip?.netPayMinor).toBeGreaterThan(0n);
  });

  it("payroll_runs can reach computed/paid/cancelled directly — the constraint no longer blocks them", async () => {
    // computed/paid/cancelled are allowed by payroll_runs_status_check_extended's
    // evident intent but (grep-verified repo-wide) have no application-level
    // writer/transition wired through assertRunStatusTransition yet — this
    // exercises the CHECK constraint itself, which is what migration 0047
    // changes, independent of that separate, out-of-scope wiring gap.
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      for (const status of ["computed", "paid", "cancelled"] as const) {
        await tx.update(payrollRuns).set({ status }).where(eq(payrollRuns.id, RUN_ID));
        const rows = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, RUN_ID));
        expect(rows[0]?.status).toBe(status);
      }
    }));
  });
});
