/**
 * GAP-HR-LEAVE-APPLY-05 -- payroll side of half-day leave.
 *
 * Covers (no DB / network): the LOP-day maths (whole-day behaviour unchanged,
 * part-day carried to two decimals), the bigint deduction helpers (identical
 * to the historical formula for whole days, exact for half days), the
 * leaveApproved consumer feeding the ledger the exact fraction, and F&F leave
 * encashment / exemption pricing a half-day balance.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, upsertLopDaysMock, fetchLeaveLopFractionBpsMock } = vi.hoisted(() => {
  const tx = { insert: vi.fn(), update: vi.fn(), select: vi.fn() };
  return {
    mockTx: tx,
    dbTransactionFn: vi.fn(async (cb: (t: unknown) => Promise<void>) => { await cb(tx); }) as any,
    upsertLopDaysMock: vi.fn(async () => undefined) as any,
    fetchLeaveLopFractionBpsMock: vi.fn(async () => 10000) as any,
  };
});

vi.mock("../src/shared/db.js", () => ({ scopedRead: dbTransactionFn, db: { transaction: dbTransactionFn } }));
vi.mock("../src/shared/outbox.js", () => ({ enqueue: vi.fn(async () => undefined), markProcessed: vi.fn(async () => true) }));
vi.mock("../src/modules/integration/lop-repo.js", () => ({ upsertLopDays: (...a: any[]) => upsertLopDaysMock(...a) }));
vi.mock("../src/modules/statutory/repo.js", () => ({ insertGratuity: vi.fn(async () => undefined) }));
vi.mock("../src/shared/infra.js", () => ({ cache: { invalidate: vi.fn(async () => undefined), makeKey: vi.fn((...p: string[]) => p.join(":")) } }));
vi.mock("../src/shared/hrms-client.js", () => ({
  fetchAttendanceLopApplies: vi.fn(async () => true),
  fetchLeaveLopFractionBps: (...a: any[]) => fetchLeaveLopFractionBpsMock(...a),
}));

import { registerIntegrationConsumers } from "../src/modules/integration/consumer.js";
import { CONSUMED_EVENTS } from "../src/topics.js";
import { leaveLopDays, lopDeductionMinor, proratedPayMinor } from "../src/modules/integration/lop-math.js";
import { computeLeaveEncashmentGrossMinor, roundRupee } from "../src/modules/payroll/domain.js";
import { computeLeaveEncashExemption } from "../src/modules/tax/exemptions.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const settle = () => new Promise<void>((r) => setTimeout(r, 150));

describe("leaveLopDays", () => {
  it("keeps whole-day rounding byte-for-byte (3 days half pay -> 2, unpaid -> days, paid -> 0)", () => {
    expect(leaveLopDays({ daysApplied: 3 }, 5000)).toBe(2);
    expect(leaveLopDays({ daysApplied: 3 }, 10000)).toBe(3);
    expect(leaveLopDays({ daysApplied: 3 }, 0)).toBe(0);
    // an integer daysExact on a 'full' row is still the whole-day path
    expect(leaveLopDays({ daysApplied: 3, daysExact: 3, dayPart: "full" }, 5000)).toBe(2);
  });
  it("carries a half-day to two decimals instead of rounding it up to a whole LOP day", () => {
    expect(leaveLopDays({ daysApplied: 1, daysExact: 0.5, dayPart: "first_half" }, 10000)).toBe(0.5);
    expect(leaveLopDays({ daysApplied: 1, daysExact: 0.5, dayPart: "short_leave" }, 5000)).toBe(0.25);
    expect(leaveLopDays({ daysApplied: 1, daysExact: 0.5, dayPart: "second_half" }, 0)).toBe(0);
  });
  it("a payload from a pre-half-day hrms-service (no daysExact/dayPart) behaves as before", () => {
    expect(leaveLopDays({ daysApplied: 1 }, 10000)).toBe(1);
  });
});

describe("LOP money maths (bigint paise)", () => {
  const base = 6_000_000n; // Rs 60,000.00 in paise
  const month = 30n;
  it("whole-day LOP equals the historical (base * lopDays) / daysInMonth formula", () => {
    for (const d of [0, 1, 2, 7, 30]) {
      expect(lopDeductionMinor(base, d, month)).toBe((base * BigInt(d)) / month);
      expect(proratedPayMinor(base, d, month)).toBe((base * (month - BigInt(d))) / month);
    }
  });
  it("half a day withholds exactly half a day's pay", () => {
    expect(lopDeductionMinor(base, 0.5, month)).toBe(100_000n); // 60000 / 30 / 2 = Rs 1,000.00
    expect(lopDeductionMinor(base, 1.5, month)).toBe(300_000n);
    expect(proratedPayMinor(base, 0.5, month)).toBe(base - 100_000n);
  });
});

describe("integration consumer: hrms.leave.approved with a half-day payload", () => {
  beforeEach(() => { vi.clearAllMocks(); fetchLeaveLopFractionBpsMock.mockResolvedValue(10000); });
  async function send(payload: Record<string, unknown>) {
    const q = new MemoryQueue();
    registerIntegrationConsumers(q);
    await q.start();
    await q.publish(CONSUMED_EVENTS.leaveApproved, {
      messageId: randomUUID(), type: CONSUMED_EVENTS.leaveApproved, tenantId: TENANT,
      actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0", payload,
    });
    await settle();
    await q.stop();
  }
  it("ledgers 0.5 for an unpaid half day (daysApplied is the CEIL shadow 1)", async () => {
    await send({ employeeId: "e1", daysApplied: 1, daysExact: 0.5, dayPart: "first_half", fromDate: "2026-10-05", leaveTypeId: "lt" });
    expect(upsertLopDaysMock).toHaveBeenCalledOnce();
    expect(upsertLopDaysMock.mock.calls[0]![5]).toBe(0.5);
  });
  it("a half day of a fully paid leave type ledgers nothing", async () => {
    fetchLeaveLopFractionBpsMock.mockResolvedValue(0);
    await send({ employeeId: "e1", daysApplied: 1, daysExact: 0.5, dayPart: "first_half", fromDate: "2026-10-05", leaveTypeId: "lt" });
    expect(upsertLopDaysMock).not.toHaveBeenCalled();
  });
});

describe("F&F leave encashment with a half-day balance", () => {
  it("whole-day balance prices exactly as before", () => {
    const basic = 5_000_000n, da = 2_000_000n;
    expect(computeLeaveEncashmentGrossMinor(basic, da, 30)).toBe(roundRupee(((basic + da) * 30n) / 30n));
    expect(computeLeaveEncashmentGrossMinor(basic, da, 7)).toBe(roundRupee(((basic + da) * 7n) / 30n));
  });
  it("10.5 days is priced as 10.5 days (not truncated to 10)", () => {
    const basic = 5_000_000n, da = 2_000_000n;
    const half = computeLeaveEncashmentGrossMinor(basic, da, 10.5);
    expect(half).toBeGreaterThan(computeLeaveEncashmentGrossMinor(basic, da, 10));
    expect(half).toBe(roundRupee(((basic + da) * 21n) / 60n));
  });
  it("caps at 300 days and ignores a non-positive balance", () => {
    expect(computeLeaveEncashmentGrossMinor(1000n, 0n, 0)).toBe(0n);
    expect(computeLeaveEncashmentGrossMinor(3_000n, 0n, 450.5)).toBe(computeLeaveEncashmentGrossMinor(3_000n, 0n, 300));
  });
  it("the Section 10(10AA) cash-equivalent limb counts the half day", () => {
    const base = {
      actualEncashmentMinor: 10_000_000n, avgSalaryLast10MonthsMinor: 3_000_000n, completedYears: 20,
      employeeCategory: "non_govt_covered" as const, separationType: "retirement" as const,
      ceilingMinor: 100_000_000n, priorExemptionClaimedMinor: 0n,
    };
    const whole = computeLeaveEncashExemption({ ...base, leaveBalanceDays: 10 });
    const half = computeLeaveEncashExemption({ ...base, leaveBalanceDays: 10.5 });
    expect(half.exemptMinor).toBeGreaterThan(whole.exemptMinor);
    expect(half.exemptMinor).toBe((3_000_000n * 21n) / 60n);
  });
});
