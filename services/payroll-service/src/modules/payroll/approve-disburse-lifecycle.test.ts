import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import type { RequestContext } from "@civitasone/types";
import { db, sqlClient } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { registerPayrollConsumers } from "./consumer.js";
import { approveRun, disburseRun } from "./commands.js";

// commands.ts's approveRun/disburseRun publish through the shared `queue`
// singleton exported by shared/infra.js (created once via createQueue()).
// registerPayrollConsumers MUST subscribe on that SAME instance - a separate
// `new MemoryQueue()` here would never see those publishes.
const memQueue = queue as unknown as MemoryQueue;

/**
 * REGRESSION (payroll-approve-disburse-noop campaign): PATCH .../approve and
 * .../disburse returned 202 with a real command id, but payroll_runs.status /
 * approved_at / disbursed_at never actually changed in the database — a
 * super_admin attempt against a run in a valid pre-approval state still saw
 * no-op. No existing test exercised registerPayrollConsumers' runApprove /
 * runDisburse handlers at all (consumer.ts is excluded from this service's
 * coverage thresholds), so this bug shipped with zero regression coverage.
 *
 * This test runs the REAL consumer (registerPayrollConsumers) against a REAL
 * Postgres (RLS-enforced), driven through a REAL MemoryQueue — i.e. it
 * exercises the actual async CQRS path end to end, not a mocked repo.
 */
describe("payroll run approve/disburse lifecycle (REGRESSION: silent no-op)", () => {
  const tenantId = randomUUID();
  const creatorId = randomUUID();
  const approverId = randomUUID(); // distinct from creator - avoids SELF_APPROVAL_FORBIDDEN
  const runId = randomUUID();
  const structureId = randomUUID();
  const employeeId = randomUUID();
  // Non-zero, realistic slip amounts - exercises the totalGross > 0n GL-accrual
  // enqueue branch in runApprove (skipped entirely by an all-zero run) and a
  // genuine (non-trivial) reconciliation in runDisburse, not just the 0n === 0n
  // case a zero-slip run would trivially satisfy.
  const grossMinor = 5_000_000n; // Rs 50,000.00
  const netPayMinor = 4_200_000n; // Rs 42,000.00

  beforeAll(async () => {
    registerPayrollConsumers(queue);
    await queue.start();

    // Seed a run directly in "processing" - the valid pre-approval state per
    // domain.ts's assertRunStatusTransition state machine
    // (draft -> processing -> {approved, failed} -> disbursed) - bypassing
    // full HRMS-dependent employee processing, which is irrelevant to this
    // bug (createRun/processPayrollRun are not in question here). A real
    // slip is seeded alongside it so approve/disburse exercise their
    // non-zero-amount branches, not just the degenerate all-zero case.
    await runWithTenant(tenantId, () =>
      db.transaction(async (tx) => {
        await repo.insertRun(tx, {
          id: runId,
          tenantId,
          runNo: "TEST-APPROVE-DISBURSE-1",
          month: "2026-09",
          departmentId: null,
          structureId,
          runType: "regular",
          ddoCode: null,
          totalGrossMinor: 0n,
          totalNetMinor: 0n,
          currency: "INR",
          status: "processing",
          createdBy: creatorId,
          updatedBy: creatorId,
        });
        await repo.insertSlip(tx, {
          id: randomUUID(),
          tenantId,
          runId,
          employeeId,
          employeeNo: "EMP-TEST-1",
          basicMinor: 3_000_000n,
          grossMinor,
          totalDeductionsMinor: grossMinor - netPayMinor,
          netPayMinor,
          currency: "INR",
          components: [{ code: "BASIC", name: "Basic", type: "earning", amountMinor: 3000000 }],
          status: "computed",
          createdBy: creatorId,
          updatedBy: creatorId,
        });
      }),
    );
  });

  afterAll(async () => {
    await queue.stop();
    await sqlClient.end();
  });

  async function drain(): Promise<void> {
    await memQueue.drain();
  }

  function superAdminCtx(): RequestContext {
    return {
      tenantId,
      actorId: approverId,
      actorType: "user",
      roles: ["super_admin"],
      correlationId: randomUUID(),
    };
  }

  it("approve genuinely updates status to 'approved' and sets approved_at in the database", async () => {
    await approveRun(superAdminCtx(), runId);
    await drain();

    const row = await runWithTenant(tenantId, () => db.transaction((tx) => repo.findRunByIdTx(tx, runId)));
    expect(row).not.toBeNull();
    expect(row?.status).toBe("approved");
    expect(row?.approvedAt).not.toBeNull();
    expect(row?.approvedBy).toBe(approverId);
    expect(row?.totalGrossMinor).toBe(grossMinor);
    expect(row?.totalNetMinor).toBe(netPayMinor);
  });

  it("disburse genuinely updates status to 'disbursed' and sets disbursed_at in the database", async () => {
    await disburseRun(superAdminCtx(), runId);
    await drain();

    const row = await runWithTenant(tenantId, () => db.transaction((tx) => repo.findRunByIdTx(tx, runId)));
    expect(row).not.toBeNull();
    expect(row?.status).toBe("disbursed");
    expect(row?.disbursedAt).not.toBeNull();
  });
});
