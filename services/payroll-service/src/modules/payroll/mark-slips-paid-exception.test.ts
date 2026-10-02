import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import { registerIntegrationConsumers } from "../integration/consumer.js";
import * as repo from "./repo.js";
import { payrollSlips } from "./schema.js";

const memQueue = queue as unknown as MemoryQueue;

/**
 * REGRESSION (money): when finance confirms a payroll run's payment
 * (finance.payment.made -> markSlipsPaidForRun), every slip in the run was set
 * to "paid" -- including "exception" (negative-net) slips, which runDisburse
 * excludes from the disbursed amount. Those slips were recorded as paid
 * although no money moved, and became printable. Drives the REAL integration
 * consumer against a REAL migrated Postgres (RLS-enforced).
 */
describe("finance.payment.made marks only disbursed slips paid (exception slips untouched)", () => {
  const tenantId = randomUUID();
  const actorId = randomUUID();
  const runId = randomUUID();
  const normalSlipId = randomUUID();
  const exceptionSlipId = randomUUID();

  beforeAll(async () => {
    registerIntegrationConsumers(queue);
    await queue.start();
    await runWithTenant(tenantId, () =>
      db.transaction(async (tx) => {
        await repo.insertRun(tx, {
          id: runId, tenantId, runNo: "TEST-EXCEPTION-PAID-1", month: "2026-08",
          departmentId: null, structureId: randomUUID(), runType: "regular", ddoCode: null,
          totalGrossMinor: 5_000_000n, totalNetMinor: 4_200_000n, currency: "INR",
          status: "disbursed", createdBy: actorId, updatedBy: actorId,
        });
        const base = {
          tenantId, runId, basicMinor: 3_000_000n, grossMinor: 5_000_000n, currency: "INR",
          components: [], createdBy: actorId, updatedBy: actorId,
        };
        await repo.insertSlip(tx, {
          ...base, id: normalSlipId, employeeId: randomUUID(), employeeNo: "EMP-OK-1",
          totalDeductionsMinor: 800_000n, netPayMinor: 4_200_000n, status: "computed",
        });
        await repo.insertSlip(tx, {
          ...base, id: exceptionSlipId, employeeId: randomUUID(), employeeNo: "EMP-NEG-1",
          totalDeductionsMinor: 5_500_000n, netPayMinor: -500_000n, status: "exception",
        });
      }),
    );
  });

  afterAll(async () => {
    await queue.stop();
    await sqlClient.end();
  });

  it("marks the normal slip paid and leaves the exception slip as exception", async () => {
    await queue.publish(CONSUMED_EVENTS.financePaymentMade, {
      messageId: randomUUID(),
      type: CONSUMED_EVENTS.financePaymentMade,
      tenantId,
      actorId,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { payrollRunId: runId, outcome: "success" },
    });
    await memQueue.drain();

    const statusOf = (id: string) =>
      runWithTenant(tenantId, () => db.transaction(async (tx) => {
        const rows = await tx.select({ status: payrollSlips.status }).from(payrollSlips).where(eq(payrollSlips.id, id));
        return rows[0]?.status;
      }));
    expect(await statusOf(normalSlipId)).toBe("paid");
    expect(await statusOf(exceptionSlipId)).toBe("exception");
  });
});
