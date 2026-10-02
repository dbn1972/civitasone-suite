/**
 * PAY-PROFILES (PR2): Full & Final on separation follows the pay profile on
 * the employee's latest slip.
 *
 *  - no profile (legacy slips)  -> exactly the legacy settlement (Basic + DA)
 *  - deputed-IN deputationist   -> final salary only: no gratuity, no leave
 *                                  encashment (the parent organisation's)
 *  - consolidated contract      -> wages = consolidated amount, no central DA
 *                                  (and no DA-rate lookup needed)
 *  - engagement not gratuity-eligible -> gratuity gate sent to F&F
 *
 * Same mocked-DB harness as integration-separation-gratuity.test.ts; the
 * consumer's raw SQL calls are answered in order (profile lookup, then DA).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, executeQueue, insertGratuityMock, enqueued } = vi.hoisted(() => {
  const _queue: Array<Array<Record<string, unknown>>> = [];
  const _tx = {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) }),
    execute: vi.fn(async () => _queue.shift() ?? []),
  };
  return {
    mockTx: _tx,
    executeQueue: _queue,
    insertGratuityMock: vi.fn(async (..._a: unknown[]) => undefined),
    enqueued: [] as Array<{ topic: string; payload: Record<string, unknown> }>,
  };
});

vi.mock("../src/shared/db.js", () => {
  const transaction = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
  return { scopedRead: transaction, db: { transaction } };
});
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: Record<string, unknown> }) => { enqueued.push({ topic: msg.topic, payload: msg.payload }); }),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("../src/modules/integration/lop-repo.js", () => ({ upsertLopDays: vi.fn(async () => undefined) }));
vi.mock("../src/modules/statutory/repo.js", () => ({
  insertGratuity: (...a: unknown[]) => insertGratuityMock(...a),
  insertPf: vi.fn(), insertEsi: vi.fn(), insertTds: vi.fn(), insertGpf: vi.fn(), insertNps: vi.fn(),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: vi.fn(async () => undefined), makeKey: vi.fn((...p: string[]) => p.join(":")) },
}));

import { registerIntegrationConsumers } from "../src/modules/integration/consumer.js";
import { CONSUMED_EVENTS, COMMANDS } from "../src/topics.js";
import { computeGratuity, computeLeaveEncashmentGrossMinor } from "../src/modules/payroll/domain.js";

// Same tenure arithmetic as the consumer (2014-01-01 -> 2026-11-30).
const YEARS = (new Date("2026-11-30").getTime() - new Date("2014-01-01").getTime()) / (365.25 * 86400000);

const TENANT = "10000000-aaaa-4000-8000-0000000000f1";

async function separate(lastSlip: Record<string, unknown> | null, daRows: Array<Record<string, unknown>> | null, payload: Record<string, unknown> = {}) {
  executeQueue.length = 0;
  executeQueue.push(lastSlip ? [lastSlip] : []);
  if (daRows) executeQueue.push(daRows);
  const q = new MemoryQueue();
  registerIntegrationConsumers(q);
  await q.start();
  await q.publish(CONSUMED_EVENTS.employeeSeparated, {
    messageId: randomUUID(), type: CONSUMED_EVENTS.employeeSeparated, tenantId: TENANT, actorId: randomUUID(),
    correlationId: "c", schemaVersion: "1.0",
    payload: { employeeId: "emp-1", effectiveDate: "2026-11-30", basicMinor: "5000000", dateOfJoining: "2014-01-01", encashmentDays: 100, ...payload },
  });
  await new Promise((r) => setTimeout(r, 150));
  await q.stop();
  return enqueued.find((m) => m.topic === COMMANDS.fnfCompute)?.payload;
}

beforeEach(() => {
  vi.clearAllMocks();
  enqueued.length = 0;
});

describe("F&F by pay profile", () => {
  it("legacy (no profile on the last slip): Basic + DA, gratuity + encashment, no gates sent", async () => {
    const fnf = await separate(null, [{ rate_bps: 5000 }]);
    expect(fnf).toMatchObject({ lastDrawnWagesMinor: "7500000" });
    expect(BigInt(fnf!.gratuityGrossMinor as string)).toBeGreaterThan(0n);
    expect(fnf!.leaveEncashmentGrossMinor).toBe(computeLeaveEncashmentGrossMinor(5_000_000n, 2_500_000n, 100).toString());
    expect(fnf!.gratuityGrossMinor).toBe(computeGratuity(YEARS, 5_000_000n, 2_500_000n).toString());
    expect(fnf).not.toHaveProperty("eligibleForGratuity");
    expect(fnf).not.toHaveProperty("leaveEncashmentEligible");
    expect(insertGratuityMock).toHaveBeenCalledOnce();
  });

  it("deputed-IN deputationist: final salary only (no gratuity, no encashment)", async () => {
    const fnf = await separate({ pay_profile: "deputation_parent_scale", profile_snapshot: { direction: "in", daSource: "central" } }, [{ rate_bps: 5000 }]);
    expect(fnf).toMatchObject({ gratuityGrossMinor: "0", leaveEncashmentGrossMinor: "0", eligibleForGratuity: false, leaveEncashmentEligible: false, lastDrawnWagesMinor: "7500000" });
    expect(insertGratuityMock).not.toHaveBeenCalled();
  });

  it("deputed-OUT deputationist keeps the normal settlement", async () => {
    const fnf = await separate({ pay_profile: "deputation_post_scale", profile_snapshot: { direction: "out" } }, [{ rate_bps: 5000 }]);
    expect(BigInt(fnf!.gratuityGrossMinor as string)).toBeGreaterThan(0n);
    expect(fnf).not.toHaveProperty("eligibleForGratuity");
  });

  it("consolidated: wages = consolidated amount, no DA (no DA lookup even when no rate exists); encashment as the engagement policy grants", async () => {
    const fnf = await separate({ pay_profile: "consolidated_contract", profile_snapshot: { consolidatedMonthlyMinor: "3000000", leaveEncashmentEligible: true } }, null);
    expect(fnf).toMatchObject({ lastDrawnWagesMinor: "3000000" });
    expect(fnf!.leaveEncashmentGrossMinor).toBe(computeLeaveEncashmentGrossMinor(3_000_000n, 0n, 100).toString());
    expect(fnf!.gratuityGrossMinor).toBe(computeGratuity(YEARS, 3_000_000n, 0n).toString());
    expect(BigInt(fnf!.gratuityGrossMinor as string)).toBeGreaterThan(0n);
  });

  it("engagement not gratuity-eligible: gratuity 0 and the gate is sent", async () => {
    const fnf = await separate({ pay_profile: "consolidated_contract", profile_snapshot: { consolidatedMonthlyMinor: "3000000", eligibleForGratuity: false, leaveEncashmentEligible: true } }, null);
    expect(fnf).toMatchObject({ gratuityGrossMinor: "0", eligibleForGratuity: false });
    expect(fnf).not.toHaveProperty("leaveEncashmentEligible");
  });

  it("consolidated without a leave-encashment grant: no encashment, gate sent", async () => {
    const fnf = await separate({ pay_profile: "consolidated_contract", profile_snapshot: { consolidatedMonthlyMinor: "3000000" } }, null);
    expect(fnf).toMatchObject({ leaveEncashmentGrossMinor: "0", leaveEncashmentEligible: false });
  });

  it("deputed-IN with no slip yet: the event's profile still gives final salary only", async () => {
    const fnf = await separate(null, [{ rate_bps: 5000 }], { payProfile: { profile: "deputation_parent_scale", deputationDirection: "in" } });
    expect(fnf).toMatchObject({ gratuityGrossMinor: "0", leaveEncashmentGrossMinor: "0", eligibleForGratuity: false, leaveEncashmentEligible: false });
  });
});
