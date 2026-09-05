/**
 * payroll-service nested-transaction connection-pool deadlock regression.
 *
 * `runApprove` and `runDisburse` (payroll/consumer.ts) each ran inside an
 * already-open outer `db.transaction(async (tx) => {...})` and looked up the
 * run's slips via `repo.listSlipsByRun()` (runApprove also summed employer
 * statutory contributions via `statutoryRepo.sumEmployerContribByRun()`) --
 * both `scopedRead`-based, i.e. each opens a SECOND `db.transaction()` on
 * the SAME connection pool as the outer command. With `pool.max = 10`
 * (packages/db/src/pool.ts), enough concurrent approvals or disbursements
 * exhaust the pool and every one of them deadlocks waiting for a connection
 * its own nested lookup will never get -- the same shape as
 * notification-service's checkQuota/checkDlt deadlock (PR #1028) and
 * building-service's submitApplication/issuePermit/decideApplication
 * deadlock (PR #1035). Found via the production-readiness-audit skill
 * (.claude/skills/16-production-readiness-audit.md, section 1) on the
 * ACTUAL EFT-initiation / salary-disbursement path, not a peripheral one.
 *
 * Fixed by routing both call sites onto the caller's already-open `tx` via
 * `repo.listSlipsByRunTx` (pre-existing, added for a different call site but
 * not applied here) and the new `statutoryRepo.sumEmployerContribByRunTx`.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { payrollRuns, payrollSlips } from "../src/modules/payroll/schema.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "90000000-dead-4000-8000-00000000c0de";
const CREATOR = "90000000-dead-4000-8000-0000000ac70a";
const APPROVER = "90000000-dead-4000-8000-0000000ac70b";

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(payrollSlips).where(eq(payrollSlips.tenantId, TENANT));
    await tx.delete(payrollRuns).where(eq(payrollRuns.tenantId, TENANT));
  }));
}

function makeMsg(type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type, tenantId: TENANT, actorId: APPROVER,
    correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}

async function seedRun(status: "processing" | "approved", opts: { grossMinor: bigint; netMinor: bigint }): Promise<string> {
  const runId = randomUUID();
  const slipId = randomUUID();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(payrollRuns).values({
      id: runId, tenantId: TENANT, runNo: `TEST/${runId.slice(0, 8)}`, month: "2026-09",
      // ux_payroll_runs_tenant_month_ddo_regular is unique on
      // (tenant_id, month, COALESCE(ddo_code, '__ALL__')) for run_type='regular'
      // -- each seeded run needs its own ddoCode so concurrent-approval tests
      // can seed many runs in the same tenant+month without colliding.
      ddoCode: `DDO-${runId.slice(0, 8)}`,
      structureId: randomUUID(), status,
      totalGrossMinor: status === "approved" ? opts.grossMinor : 0n,
      totalNetMinor: status === "approved" ? opts.netMinor : 0n,
      createdBy: CREATOR, updatedBy: CREATOR,
    });
    await tx.insert(payrollSlips).values({
      id: slipId, tenantId: TENANT, runId, employeeId: randomUUID(), employeeNo: "EMP-TEST",
      grossMinor: opts.grossMinor, netPayMinor: opts.netMinor, status: "computed",
      createdBy: CREATOR, updatedBy: CREATOR,
    });
  }));
  return runId;
}

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("payroll run approve/disburse -- nested-transaction regression", () => {
  it("runApprove completes end-to-end, reading slips/statutory sums via the outer tx", async () => {
    const queue = new MemoryQueue();
    registerPayrollConsumers(queue);
    const runId = await seedRun("processing", { grossMinor: 100000n, netMinor: 80000n });

    await queue.publish(COMMANDS.runApprove, makeMsg(COMMANDS.runApprove, { id: runId, tenantId: TENANT, approvedBy: APPROVER }));
    await queue.drain();

    expect(queue.dlq).toHaveLength(0);
    const [run] = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId))));
    expect(run?.status).toBe("approved");
    expect(run?.totalGrossMinor).toBe(100000n);
    expect(run?.totalNetMinor).toBe(80000n);
  });

  it("runDisburse completes end-to-end, reading slips via the outer tx for reconciliation", async () => {
    const queue = new MemoryQueue();
    registerPayrollConsumers(queue);
    const runId = await seedRun("approved", { grossMinor: 100000n, netMinor: 80000n });

    await queue.publish(COMMANDS.runDisburse, makeMsg(COMMANDS.runDisburse, { id: runId, tenantId: TENANT }));
    await queue.drain();

    expect(queue.dlq).toHaveLength(0);
    const [run] = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId))));
    expect(run?.status).toBe("disbursed");
  });

  it("handles concurrent runApprove commands across pool.max (10) without deadlocking", async () => {
    const queue = new MemoryQueue();
    registerPayrollConsumers(queue);
    const runIds = await Promise.all(
      Array.from({ length: 15 }, () => seedRun("processing", { grossMinor: 50000n, netMinor: 40000n })),
    );

    await Promise.all(runIds.map((id) =>
      queue.publish(COMMANDS.runApprove, makeMsg(COMMANDS.runApprove, { id, tenantId: TENANT, approvedBy: APPROVER })),
    ));
    await queue.drain();

    expect(queue.dlq).toHaveLength(0);
    for (const id of runIds) {
      const [run] = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(payrollRuns).where(eq(payrollRuns.id, id))));
      expect(run?.status).toBe("approved");
    }
  });

  it("handles concurrent runDisburse commands across pool.max (10) without deadlocking", async () => {
    const queue = new MemoryQueue();
    registerPayrollConsumers(queue);
    const runIds = await Promise.all(
      Array.from({ length: 15 }, () => seedRun("approved", { grossMinor: 50000n, netMinor: 40000n })),
    );

    await Promise.all(runIds.map((id) =>
      queue.publish(COMMANDS.runDisburse, makeMsg(COMMANDS.runDisburse, { id, tenantId: TENANT })),
    ));
    await queue.drain();

    expect(queue.dlq).toHaveLength(0);
    for (const id of runIds) {
      const [run] = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(payrollRuns).where(eq(payrollRuns.id, id))));
      expect(run?.status).toBe("disbursed");
    }
  });
});
