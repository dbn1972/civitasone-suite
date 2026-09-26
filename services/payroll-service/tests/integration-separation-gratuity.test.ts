/**
 * Integration test: Employee separated → Payroll gratuity computed
 *
 * Verifies that when `hrms.employee.separated` is published, the payroll
 * integration consumer:
 *   - Computes gratuity for employees with ≥5 years of service
 *   - Calls statutoryRepo.insertGratuity with correct amount
 *   - Emits an audit event (audit.event.record) on successful computation
 *   - Does NOT compute/insert when years of service < 5
 *
 * Uses vi.mock to stub DB and outbox — no live database required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

// ---------------------------------------------------------------------------
// Module mocks — declared before importing the consumer.
// ---------------------------------------------------------------------------

const {
  mockTx,
  dbTransactionFn,
  insertGratuityMock,
  markProcessedMock,
  enqueuedMessages,
  executeResult,
} = vi.hoisted(() => {
  const _executeResult: { rows: Array<Record<string, unknown>> } = { rows: [] };
  const _mockTx = {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    }),
    // Raw SQL execution — used by the consumer to resolve DA rates.
    execute: vi.fn(async () => _executeResult.rows),
  };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(_mockTx);
  });
  const _insertGratuityMock = vi.fn(async () => undefined);
  const _markProcessedMock = vi.fn(async () => true);
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    insertGratuityMock: _insertGratuityMock as any,
    markProcessedMock: _markProcessedMock as any,
    enqueuedMessages: _enqueuedMessages,
    executeResult: _executeResult,
  };
});

// 1. DB mock.
vi.mock("../src/shared/db.js", () => ({
  scopedRead: dbTransactionFn,
  db: { transaction: dbTransactionFn },
}));

// 2. Outbox — capture enqueue calls + markProcessed.
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => {
    enqueuedMessages.push({ topic: msg.topic, payload: msg.payload });
  }),
  markProcessed: (...args: any[]) => markProcessedMock(...args),
}));

// 3. LOP repo — not used for separation but may be imported.
vi.mock("../src/modules/integration/lop-repo.js", () => ({
  upsertLopDays: vi.fn(async () => undefined),
}));

// 4. Statutory repo — capture insertGratuity calls.
vi.mock("../src/modules/statutory/repo.js", () => ({
  insertGratuity: (...args: any[]) => insertGratuityMock(...args),
  insertPf: vi.fn(async () => undefined),
  insertEsi: vi.fn(async () => undefined),
  insertTds: vi.fn(async () => undefined),
  insertGpf: vi.fn(async () => undefined),
  insertNps: vi.fn(async () => undefined),
}));

// 5. Cache — no-op.
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: vi.fn(async () => undefined),
    makeKey: vi.fn((...parts: string[]) => parts.join(":")),
  },
}));

// ---------------------------------------------------------------------------
// Import consumer AFTER mocks.
// ---------------------------------------------------------------------------
import { registerIntegrationConsumers } from "../src/modules/integration/consumer.js";
import { CONSUMED_EVENTS, COMMANDS } from "../src/topics.js";
import { computeFnfSettlement, type FnfInput } from "../src/modules/fnf/domain.js";

// Statutory exemption ceilings, mirroring fnf/consumer.ts's own fallback
// values when no exemption_ceilings row exists for the FY (this test harness
// has no DB, so these fallbacks are what a real run would use too).
const DEFAULT_CEILINGS = {
  gratuityCeilingMinor: 2_000_000_000n,
  leaveEncashCeilingMinor: 2_500_000_000n,
  retrenchmentCeilingMinor: 500_000_000n,
  vrsCeilingMinor: 500_000_000n,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR  = "20000000-bbbb-4000-8000-000000000001";

function makeMsg(type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: `corr-${randomUUID()}`,
    schemaVersion: "1.0",
    payload,
  };
}

async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue();
  registerIntegrationConsumers(q);
  await q.start();
  return q;
}

const settle = () => new Promise<void>((r) => setTimeout(r, 200));

// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  // PRE-EXISTING TEST-ORDER BUG (found while adding the F&F regression tests
  // below): the "idempotent" test further down queues
  // .mockResolvedValueOnce(true).mockResolvedValueOnce(false) but only ever
  // consumes ONE of them, and vi.clearAllMocks() clears call history but NOT
  // queued once-implementations -- so the dangling `false` silently carried
  // over into whichever test ran next (its handler's very first
  // markProcessed() call returned false, skipping the whole transaction body
  // -- no gratuity insert, no audit, no fnfCompute publish -- with no
  // assertion failure pointing at the real cause). Exactly the "tests must
  // be order-independent" hazard docs/TEST-INFRA.md warns about, since
  // Vitest randomizes test order by default. mockReset() clears any queued
  // implementation before the fresh default is set below.
  markProcessedMock.mockReset();
  markProcessedMock.mockResolvedValue(true);
  // Default: DA rate = 5% (500 bps). Non-zero so gratuity emoluments include DA.
  executeResult.rows = [{ rate_bps: 500 }];
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(mockTx);
  });
});

// ---------------------------------------------------------------------------
// TASK 3 — Employee separated → gratuity computed
// ---------------------------------------------------------------------------
describe("hrms.employee.separated → gratuity computation", () => {
  it("computes gratuity for 10+ years of service and calls insertGratuity", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.employeeSeparated,
      makeMsg(CONSUMED_EVENTS.employeeSeparated, {
        employeeId: "emp-1",
        effectiveDate: "2025-06-30",
        basicMinor: "5000000", // 50,000 INR
        dateOfJoining: "2015-01-01", // ~10.5 years of service
      }),
    );
    await settle();

    expect(insertGratuityMock).toHaveBeenCalledOnce();
    const [tx, row] = insertGratuityMock.mock.calls[0]!;
    expect(row.tenantId).toBe(TENANT);
    expect(row.employeeId).toBe("emp-1");
    expect(row.separationRef).toBe("separation:2025-06-30");
    expect(row.currency).toBe("INR");
    expect(row.status).toBe("computed");
    // Gratuity for 10+ years with 50k basic + DA should be > 0.
    expect(typeof row.gratuityMinor).toBe("bigint");
    expect(row.gratuityMinor).toBeGreaterThan(0n);
    await q.stop();
  });

  it("emits audit.event.record on successful gratuity computation", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.employeeSeparated,
      makeMsg(CONSUMED_EVENTS.employeeSeparated, {
        employeeId: "emp-1",
        effectiveDate: "2025-06-30",
        basicMinor: "5000000",
        dateOfJoining: "2015-01-01",
      }),
    );
    await settle();

    const auditEvent = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(auditEvent, "expected audit.event.record to be emitted").toBeDefined();

    const payload = auditEvent!.payload as Record<string, unknown>;
    expect(payload.service).toBe("payroll");
    expect(payload.action).toBe("gratuity_compute");
    expect(payload.resourceType).toBe("gratuity");
    expect(payload.resourceId).toBe("emp-1");
    expect(payload.outcome).toBe("success");
    await q.stop();
  });

  it("does NOT compute gratuity when years of service < 5", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.employeeSeparated,
      makeMsg(CONSUMED_EVENTS.employeeSeparated, {
        employeeId: "emp-2",
        effectiveDate: "2025-06-30",
        basicMinor: "5000000",
        dateOfJoining: "2022-01-01", // ~3.5 years — below 5-year threshold
      }),
    );
    await settle();

    expect(insertGratuityMock).not.toHaveBeenCalled();
    // No audit event either since gratuity was 0.
    const auditEvent = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(auditEvent).toBeUndefined();

    // BUG FIX REGRESSION: this used to `return` before ever publishing
    // payroll.fnf.compute whenever gratuity was 0 (< 5 years), so a
    // short-tenure separation got NO F&F settlement at all -- not even for
    // leave encashment/notice pay it was still owed regardless of gratuity
    // eligibility. It must still be published, just with a zero gratuity
    // gross (the statutory-gratuity ledger row above correctly stays
    // un-inserted -- that part is gratuity-only and unaffected).
    const fnfCompute = enqueuedMessages.find((m) => m.topic === COMMANDS.fnfCompute);
    expect(fnfCompute, "expected payroll.fnf.compute to still be published for a < 5 year separation").toBeDefined();
    const payload = fnfCompute!.payload as Record<string, unknown>;
    expect(payload.gratuityGrossMinor).toBe("0");
    expect(payload.employeeId).toBe("emp-2");
    await q.stop();
  });

  it("computes gratuity with DA included in emoluments", async () => {
    // DA = 50% (5000 bps).
    executeResult.rows = [{ rate_bps: 5000 }];
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.employeeSeparated,
      makeMsg(CONSUMED_EVENTS.employeeSeparated, {
        employeeId: "emp-3",
        effectiveDate: "2025-06-30",
        basicMinor: "3000000", // 30,000 INR basic
        dateOfJoining: "2015-01-01", // 10+ years
      }),
    );
    await settle();

    expect(insertGratuityMock).toHaveBeenCalledOnce();
    const [, row] = insertGratuityMock.mock.calls[0]!;
    // With 50% DA, emoluments = basic + DA = 30000 + 15000 = 45000 INR.
    // Gratuity = (emoluments / 26) * 15 * years (rounded).
    // The exact amount depends on computeGratuity, but it should be significantly
    // larger than without DA.
    expect(row.gratuityMinor).toBeGreaterThan(0n);
    await q.stop();
  });

  it("rejects (does not silently default to 0) when no DA rate is configured", async () => {
    // No DA rate rows at all for this tenant/date -- a configuration gap,
    // not a deliberate zero rate (which would be an explicit rate_bps=0
    // row). Previously this silently defaulted to 0 and computed gratuity
    // on basic alone with no signal anywhere; it must now reject instead.
    executeResult.rows = [];
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.employeeSeparated,
      makeMsg(CONSUMED_EVENTS.employeeSeparated, {
        employeeId: "emp-4",
        effectiveDate: "2025-06-30",
        basicMinor: "5000000",
        dateOfJoining: "2010-01-01", // 15+ years -- would otherwise qualify
      }),
    );
    await settle();

    // Non-retryable (permanent until a human adds the rate row): rejected on
    // the first attempt straight to the DLQ instead of computing (and
    // persisting) a gratuity amount that silently omits DA.
    expect(insertGratuityMock).not.toHaveBeenCalled();
    const auditEvent = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(auditEvent).toBeUndefined();
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("DA_RATE_NOT_CONFIGURED");
    await q.stop();
  });

  it("just over 5 years of service qualifies for gratuity", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.employeeSeparated,
      makeMsg(CONSUMED_EVENTS.employeeSeparated, {
        employeeId: "emp-5",
        effectiveDate: "2025-07-15",
        basicMinor: "5000000",
        dateOfJoining: "2020-06-30", // ~5.04 years — safely above the 5-year threshold
      }),
    );
    await settle();

    expect(insertGratuityMock).toHaveBeenCalledOnce();
    const [, row] = insertGratuityMock.mock.calls[0]!;
    expect(row.gratuityMinor).toBeGreaterThan(0n);
    await q.stop();
  });

  it("idempotent: duplicate message is not processed twice", async () => {
    // Second call to markProcessed returns false (already processed).
    markProcessedMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const q = await buildQueue();

    const msg = makeMsg(CONSUMED_EVENTS.employeeSeparated, {
      employeeId: "emp-6",
      effectiveDate: "2025-06-30",
      basicMinor: "5000000",
      dateOfJoining: "2015-01-01",
    });

    await q.publish(CONSUMED_EVENTS.employeeSeparated, msg);
    await settle();

    // Only one gratuity row written.
    expect(insertGratuityMock).toHaveBeenCalledOnce();
    await q.stop();
  });

  // ---------------------------------------------------------------------------
  // BUG FIX — death/disablement waiver of the 5-year minimum (Payment of
  // Gratuity Act, 1972 §4(1) first proviso / Code on Social Security, 2020
  // §53(1) proviso). computeGratuity previously had no separationType
  // parameter, so a death/disablement separation under 5 years silently
  // computed (and persisted) a zero gratuity. Confirmed live against
  // unmodified main by publishing this exact shape of event before the fix.
  // ---------------------------------------------------------------------------
  it("HAND-VERIFIED: death under 5 years now pays gratuity via the §4(1) proviso waiver (was silently 0 before the fix)", async () => {
    executeResult.rows = [{ rate_bps: 0 }]; // DA=0 -- isolates the waiver from DA arithmetic
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.employeeSeparated,
      makeMsg(CONSUMED_EVENTS.employeeSeparated, {
        employeeId: "emp-death-1",
        effectiveDate: "2025-01-01",
        basicMinor: "8000000", // ₹80,000
        dateOfJoining: "2023-01-01", // 731 days / 365.25 ≈ 2.0014y -> 2 completed years (< 5)
        separationType: "death",
      }),
    );
    await settle();

    expect(insertGratuityMock).toHaveBeenCalledOnce();
    const [, row] = insertGratuityMock.mock.calls[0]!;
    // (15/26) * ₹80,000 * 2 completed years = ₹92,307.69.., rounded to ₹92,308.
    // (This is the figure the Act's own §4(2) formula actually produces for
    // these inputs -- NOT the ~₹1,41,231 floated in the original bug report,
    // which does not match §4(2) for a 2-completed-year/₹80,000-basic/no-DA
    // separation; verified independently against the bare Act text.)
    expect(row.gratuityMinor).toBe(9_230_800n);
    expect(row.status).toBe("computed");

    const auditEvent = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(auditEvent, "gratuity is correctly non-zero, so the audit event must fire").toBeDefined();

    // Cascades into the F&F settlement too -- this used to silently carry
    // gratuityGrossMinor: "0" downstream into fnf/consumer.ts as well.
    const fnfCompute = enqueuedMessages.find((m) => m.topic === COMMANDS.fnfCompute);
    expect((fnfCompute!.payload as Record<string, unknown>).gratuityGrossMinor).toBe("9230800");
    await q.stop();
  });

  it("disablement under 5 years also pays gratuity via the waiver", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.employeeSeparated,
      makeMsg(CONSUMED_EVENTS.employeeSeparated, {
        employeeId: "emp-disabled-1",
        effectiveDate: "2025-06-30",
        basicMinor: "5000000",
        dateOfJoining: "2023-01-01", // ~2.5 years — below the 5-year threshold
        separationType: "disablement",
      }),
    );
    await settle();

    expect(insertGratuityMock).toHaveBeenCalledOnce();
    const [, row] = insertGratuityMock.mock.calls[0]!;
    expect(row.gratuityMinor).toBeGreaterThan(0n);
    await q.stop();
  });

  it("resignation under 5 years is still correctly zero — the waiver does not apply", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.employeeSeparated,
      makeMsg(CONSUMED_EVENTS.employeeSeparated, {
        employeeId: "emp-resign-1",
        effectiveDate: "2025-06-30",
        basicMinor: "8000000",
        dateOfJoining: "2023-01-01", // ~2.5 years
        separationType: "resignation",
      }),
    );
    await settle();

    expect(insertGratuityMock).not.toHaveBeenCalled();
    const auditEvent = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(auditEvent).toBeUndefined();
    // F&F settlement (leave encashment/notice pay) still goes out, but with
    // a correctly-zero gratuity gross — the pre-existing "does NOT compute
    // gratuity when years of service < 5" test above covers the
    // no-separationType case; this covers an explicit resignation type.
    const fnfCompute = enqueuedMessages.find((m) => m.topic === COMMANDS.fnfCompute);
    expect((fnfCompute!.payload as Record<string, unknown>).gratuityGrossMinor).toBe("0");
    await q.stop();
  });

  it("death at >=5 years computes via the normal formula (unaffected by the waiver)", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.employeeSeparated,
      makeMsg(CONSUMED_EVENTS.employeeSeparated, {
        employeeId: "emp-5y-death",
        effectiveDate: "2025-06-30",
        basicMinor: "5000000",
        dateOfJoining: "2015-01-01", // ~10.5 years — safely above the 5-year threshold
        separationType: "death",
      }),
    );
    await settle();

    expect(insertGratuityMock).toHaveBeenCalledOnce();
    const [, row] = insertGratuityMock.mock.calls[0]!;
    expect(row.gratuityMinor).toBeGreaterThan(0n);
    await q.stop();
  });

  it("disablement at >=5 years computes via the normal formula (unaffected by the waiver)", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.employeeSeparated,
      makeMsg(CONSUMED_EVENTS.employeeSeparated, {
        employeeId: "emp-5y-disabled",
        effectiveDate: "2025-06-30",
        basicMinor: "5000000",
        dateOfJoining: "2015-01-01", // ~10.5 years — safely above the 5-year threshold
        separationType: "disablement",
      }),
    );
    await settle();

    expect(insertGratuityMock).toHaveBeenCalledOnce();
    const [, row] = insertGratuityMock.mock.calls[0]!;
    expect(row.gratuityMinor).toBeGreaterThan(0n);
    await q.stop();
  });
});

// ---------------------------------------------------------------------------
// BUG FIX REGRESSION — all-zero F&F settlement.
//
// Root cause: this handler used to publish payroll.fnf.compute with ONLY
// {employeeId, tenantId, separationDate, separationType: "retirement"
// (hardcoded)}. fnf/consumer.ts builds FnfInput straight off an `as`-cast of
// that payload with `?? "0"`/`?? 0` fallbacks on every other field, so every
// real separation processed through this automatic path (as opposed to the
// manual finance-admin form) silently produced an all-zero fnf_settlements
// row: gratuity, leave encashment and net payable all 0 regardless of the
// employee's actual tenure or pay. None of the tests above caught it because
// they only ever assert on the statutory-gratuity side record
// (insertGratuityMock) and the audit event -- never on the fnfCompute
// payload actually published.
//
// These tests capture that payload and feed it into the REAL
// computeFnfSettlement (fnf/domain.ts, a pure function -- no DB/mocking
// needed for it), with every expected figure hand-derived below so a wrong
// answer here is caught precisely, not just "isn't zero".
// ---------------------------------------------------------------------------
describe("hrms.employee.separated → payroll.fnf.compute (full settlement, hand-verified)", () => {
  it("16 years of service, Rs 60,000 basic, 50% DA, 240 leave days — gratuity/leave-encashment/net payable all correct and non-zero", async () => {
    executeResult.rows = [{ rate_bps: 5000 }]; // 50% DA
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.employeeSeparated,
      makeMsg(CONSUMED_EVENTS.employeeSeparated, {
        employeeId: "emp-16y",
        effectiveDate: "2026-01-01",
        basicMinor: "6000000", // Rs 60,000
        dateOfJoining: "2010-01-01", // exactly 16 years (incl. 4 leap years -> 5844 days = 16 * 365.25)
        separationType: "retirement",
        encashmentDays: 240,
      }),
    );
    await settle();

    const fnfCompute = enqueuedMessages.find((m) => m.topic === COMMANDS.fnfCompute);
    expect(fnfCompute).toBeDefined();
    const payload = fnfCompute!.payload as Record<string, unknown>;

    // ── Inputs the old code silently dropped -- now present and correct ──
    expect(payload.separationType).toBe("retirement");
    expect(payload.employeeCategory).toBe("non_govt_covered"); // hrms-service's own established default
    expect(payload.completedYears).toBe(16);
    expect(payload.leaveBalanceDays).toBe(240);
    expect(payload.lastDrawnWagesMinor).toBe("9000000"); // 60,000 basic + 30,000 DA (50%)
    expect(payload.taxRegime).toBe("new");
    expect(payload.fyStartYear).toBe(2025); // separation in Jan 2026 -> FY2025-26

    // ── Gratuity: (15/26) * (Basic+DA) * completedYears, rounded to the rupee ──
    // (15 * 90,000 * 16) / 26 = 21,60,000 / 26 = Rs 8,30,769.23 -> Rs 8,30,769.
    expect(payload.gratuityGrossMinor).toBe("83076900");

    // ── Leave encashment: (Basic+DA)/30 * balance days (<=300) ──
    // 90,000 / 30 * 240 = Rs 3,000/day * 240 = Rs 7,20,000 exactly.
    expect(payload.leaveEncashmentGrossMinor).toBe("72000000");

    // ── Feed the exact payload into the real settlement engine ──
    const input: FnfInput = {
      employeeId: payload.employeeId as string,
      tenantId: payload.tenantId as string,
      separationType: payload.separationType as FnfInput["separationType"],
      separationDate: payload.separationDate as string,
      employeeCategory: payload.employeeCategory as FnfInput["employeeCategory"],
      noticeBuyoutMinor: BigInt(payload.noticeBuyoutMinor as string ?? "0"),
      leaveEncashmentGrossMinor: BigInt(payload.leaveEncashmentGrossMinor as string),
      gratuityGrossMinor: BigInt(payload.gratuityGrossMinor as string),
      retrenchmentCompMinor: BigInt(payload.retrenchmentCompMinor as string ?? "0"),
      vrsCompMinor: BigInt(payload.vrsCompMinor as string ?? "0"),
      arrearsMinor: BigInt(payload.arrearsMinor as string ?? "0"),
      lastDrawnWagesMinor: BigInt(payload.lastDrawnWagesMinor as string),
      completedYears: payload.completedYears as number,
      avgSalaryLast10MonthsMinor: BigInt(payload.avgSalaryLast10MonthsMinor as string),
      leaveBalanceDays: payload.leaveBalanceDays as number,
      priorLeaveEncashExemptionMinor: BigInt(payload.priorLeaveEncashExemptionMinor as string ?? "0"),
      remainingMonthsToRetirement: (payload.remainingMonthsToRetirement as number) ?? 0,
      taxRegime: payload.taxRegime as FnfInput["taxRegime"],
      salaryYtdMinor: BigInt(payload.salaryYtdMinor as string),
      tdsYtdMinor: BigInt(payload.tdsYtdMinor as string),
      deductions80cMinor: BigInt(payload.deductions80cMinor as string ?? "0"),
      deductions80dMinor: BigInt(payload.deductions80dMinor as string ?? "0"),
      otherDeductionsMinor: BigInt(payload.otherDeductionsMinor as string ?? "0"),
      fyStartYear: payload.fyStartYear as number,
      ...DEFAULT_CEILINGS,
    };
    const result = computeFnfSettlement(input);

    // Gratuity: actual (Rs 8,30,769) <= unrounded PG Act formula (Rs 8,30,769.23)
    // -> fully exempt under Sec 10(10).
    expect(result.gratuityExemption.exemptMinor).toBe(83_076_900n);
    expect(result.gratuityExemption.taxableMinor).toBe(0n);

    // Leave encashment: cash-equivalent limb = 90,000/30 * min(240, 16*30) =
    // 90,000/30*240 = same Rs 7,20,000 as the actual -> fully exempt too.
    expect(result.leaveEncashExemption.exemptMinor).toBe(72_000_000n);
    expect(result.leaveEncashExemption.taxableMinor).toBe(0n);

    // Total gross = gratuity + leave encashment (no notice/retrenchment/VRS/arrears).
    expect(result.totalGrossMinor).toBe(155_076_900n); // Rs 15,50,769
    // Everything is exempt and there's no YTD salary this FY, so taxable
    // income clamps to 0 regardless of the exact standard-deduction figure
    // -> zero tax -> net payable equals the full gross.
    expect(result.totalTaxableOnSeparationMinor).toBe(0n);
    expect(result.annualTaxMinor).toBe(0n);
    expect(result.tdsOnSeparationMinor).toBe(0n);
    expect(result.netPayableMinor).toBe(155_076_900n); // Rs 15,50,769 — clearly non-zero

    await q.stop();
  });

  it("generalizes to a different tenure/pay: 7 years, Rs 40,000 basic, 40% DA, 150 leave days", async () => {
    executeResult.rows = [{ rate_bps: 4000 }]; // 40% DA
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.employeeSeparated,
      makeMsg(CONSUMED_EVENTS.employeeSeparated, {
        employeeId: "emp-7y",
        effectiveDate: "2026-01-01",
        basicMinor: "4000000", // Rs 40,000
        dateOfJoining: "2019-01-01", // ~7.0007 years -> completedYears = 7
        separationType: "retirement",
        encashmentDays: 150,
      }),
    );
    await settle();

    const fnfCompute = enqueuedMessages.find((m) => m.topic === COMMANDS.fnfCompute);
    expect(fnfCompute).toBeDefined();
    const payload = fnfCompute!.payload as Record<string, unknown>;

    expect(payload.completedYears).toBe(7);
    expect(payload.lastDrawnWagesMinor).toBe("5600000"); // 40,000 + 16,000 DA (40%)

    // Gratuity: (15 * 56,000 * 7) / 26 = 5,88,000 / 26 = Rs 2,26,153.846 -> Rs 2,26,154.
    expect(payload.gratuityGrossMinor).toBe("22615400");
    // Leave encashment: 56,000/30 * 150 = Rs 1,866.67/day * 150 = Rs 2,80,000 exactly (150/30=5).
    expect(payload.leaveEncashmentGrossMinor).toBe("28000000");

    const input: FnfInput = {
      employeeId: payload.employeeId as string,
      tenantId: payload.tenantId as string,
      separationType: payload.separationType as FnfInput["separationType"],
      separationDate: payload.separationDate as string,
      employeeCategory: payload.employeeCategory as FnfInput["employeeCategory"],
      noticeBuyoutMinor: 0n,
      leaveEncashmentGrossMinor: BigInt(payload.leaveEncashmentGrossMinor as string),
      gratuityGrossMinor: BigInt(payload.gratuityGrossMinor as string),
      retrenchmentCompMinor: 0n,
      vrsCompMinor: 0n,
      arrearsMinor: 0n,
      lastDrawnWagesMinor: BigInt(payload.lastDrawnWagesMinor as string),
      completedYears: payload.completedYears as number,
      avgSalaryLast10MonthsMinor: BigInt(payload.avgSalaryLast10MonthsMinor as string),
      leaveBalanceDays: payload.leaveBalanceDays as number,
      priorLeaveEncashExemptionMinor: 0n,
      remainingMonthsToRetirement: 0,
      taxRegime: payload.taxRegime as FnfInput["taxRegime"],
      salaryYtdMinor: BigInt(payload.salaryYtdMinor as string),
      tdsYtdMinor: BigInt(payload.tdsYtdMinor as string),
      deductions80cMinor: 0n,
      deductions80dMinor: 0n,
      otherDeductionsMinor: 0n,
      fyStartYear: payload.fyStartYear as number,
      ...DEFAULT_CEILINGS,
    };
    const result = computeFnfSettlement(input);

    // Gratuity actual (Rs 2,26,154, rounded UP from Rs 2,26,153.846) is
    // fractionally ABOVE the unrounded PG Act formula this time -> a tiny
    // 16-paise taxable sliver survives the exemption, unlike scenario 1
    // where rounding went the other way. Demonstrates paise-level precision.
    expect(result.gratuityExemption.exemptMinor).toBe(22_615_384n);
    expect(result.gratuityExemption.taxableMinor).toBe(16n);

    // Leave encashment fully exempt: cash-equivalent = 56,000/30 * min(150, 7*30=210) = same Rs 2,80,000.
    expect(result.leaveEncashExemption.exemptMinor).toBe(28_000_000n);
    expect(result.leaveEncashExemption.taxableMinor).toBe(0n);

    expect(result.totalGrossMinor).toBe(50_615_400n); // Rs 5,06,154
    expect(result.totalTaxableOnSeparationMinor).toBe(16n); // negligible vs. any real standard deduction
    expect(result.annualTaxMinor).toBe(0n);
    expect(result.netPayableMinor).toBe(50_615_400n); // Rs 5,06,154 — non-zero, and correctly DIFFERENT from scenario 1

    await q.stop();
  });
});
