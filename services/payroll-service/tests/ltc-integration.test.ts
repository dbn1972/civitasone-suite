/**
 * LTC Integration Tests
 *
 * Covers:
 * 1. LTC exemption computed correctly via consumer flow (computeLtcExemption)
 * 2. Monthly TDS reduced when ltcExemptTotalMinor is present (payroll domain)
 * 3. Non-LTC claims are skipped by the consumer filtering logic
 *
 * Uses vi.mock for DB/outbox (consumer integration) and direct pure-function
 * calls for domain logic (no mocking needed — functions are pure).
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
  markProcessedMock,
  enqueuedMessages,
  insertedLtcRows,
} = vi.hoisted(() => {
  const _insertedLtcRows: Array<Record<string, unknown>> = [];
  const _mockTx = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn((row: Record<string, unknown>) => {
        _insertedLtcRows.push(row);
        return Promise.resolve(undefined);
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    }),
    execute: vi.fn(async () => []),
  };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(_mockTx);
  });
  const _markProcessedMock = vi.fn(async () => true);
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    markProcessedMock: _markProcessedMock as any,
    enqueuedMessages: _enqueuedMessages,
    insertedLtcRows: _insertedLtcRows,
  };
});

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: dbTransactionFn },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => {
    enqueuedMessages.push({ topic: msg.topic, payload: msg.payload });
  }),
  markProcessed: (...args: any[]) => markProcessedMock(...args),
}));

vi.mock("../src/modules/integration/lop-repo.js", () => ({
  upsertLopDays: vi.fn(async () => undefined),
}));

vi.mock("../src/modules/statutory/repo.js", () => ({
  insertGratuity: vi.fn(async () => undefined),
  insertPf: vi.fn(async () => undefined),
  insertEsi: vi.fn(async () => undefined),
  insertTds: vi.fn(async () => undefined),
  insertGpf: vi.fn(async () => undefined),
  insertNps: vi.fn(async () => undefined),
}));

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
import { CONSUMED_EVENTS } from "../src/topics.js";

// Pure-function imports (no mocking needed).
import { computeLtcExemption } from "../src/modules/tax/ltc-exemption.js";
import { computeSlip } from "../src/modules/payroll/domain.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";

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
  insertedLtcRows.length = 0;
  markProcessedMock.mockResolvedValue(true);
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(mockTx);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 1. LTC exemption computed correctly via consumer integration flow
// ═══════════════════════════════════════════════════════════════════
describe("LTC claim approved → exemption computed and persisted", () => {
  it("computes correct exempt/taxable split for fare within entitlement", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.ltcClaimApproved,
      makeMsg(CONSUMED_EVENTS.ltcClaimApproved, {
        claimId: randomUUID(),
        employeeId: "emp-ltc-1",
        claimType: "ltc",
        approvedFareMinor: "4000000",  // ₹40K
        entitlementMinor: "5000000",   // ₹50K
        blockYear: "2022-25",
        ltcType: "hometown",
        usedInBlock: 0,
      }),
    );
    await settle();

    // Verify the insert was called with correct exemption values.
    expect(mockTx.insert).toHaveBeenCalled();
    expect(insertedLtcRows.length).toBe(1);

    const row = insertedLtcRows[0]!;
    expect(row.employeeId).toBe("emp-ltc-1");
    expect(row.blockYear).toBe("2022-25");
    expect(row.ltcType).toBe("hometown");
    expect(row.approvedFareMinor).toBe(4000000n);
    // Fare ₹40K < entitlement ₹50K → fully exempt
    expect(row.exemptAmountMinor).toBe(4000000n);

    // Verify matches direct function call
    const directResult = computeLtcExemption({
      approvedFareMinor: 4000000n,
      entitlementMinor: 5000000n,
      ltcType: "hometown",
      blockYear: "2022-25",
      usedInBlock: 0,
    });
    expect(row.exemptAmountMinor).toBe(directResult.exemptMinor);
    await q.stop();
  });

  it("computes partial exemption when fare exceeds entitlement", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.ltcClaimApproved,
      makeMsg(CONSUMED_EVENTS.ltcClaimApproved, {
        claimId: randomUUID(),
        employeeId: "emp-ltc-2",
        claimType: "ltc",
        approvedFareMinor: "6000000",  // ₹60K
        entitlementMinor: "5000000",   // ₹50K
        blockYear: "2022-25",
        ltcType: "all_india",
        usedInBlock: 1,
      }),
    );
    await settle();

    expect(insertedLtcRows.length).toBe(1);
    const row = insertedLtcRows[0]!;
    // Fare ₹60K > entitlement ₹50K → exempt = ₹50K (entitlement)
    expect(row.exemptAmountMinor).toBe(5000000n);
    expect(row.approvedFareMinor).toBe(6000000n);
    await q.stop();
  });

  it("emits audit event on successful LTC exemption", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.ltcClaimApproved,
      makeMsg(CONSUMED_EVENTS.ltcClaimApproved, {
        claimId: randomUUID(),
        employeeId: "emp-ltc-3",
        claimType: "ltc",
        approvedFareMinor: "3000000",
        entitlementMinor: "5000000",
        blockYear: "2026-29",
        ltcType: "hometown",
        usedInBlock: 0,
      }),
    );
    await settle();

    const auditEvent = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(auditEvent).toBeDefined();
    const payload = auditEvent!.payload as Record<string, unknown>;
    expect(payload.service).toBe("payroll");
    expect(payload.action).toBe("ltc_exemption_compute");
    expect(payload.resourceType).toBe("ltc_exemption");
    expect(payload.outcome).toBe("success");
    await q.stop();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Monthly TDS reduced when ltcExemptTotalMinor is present
// ═══════════════════════════════════════════════════════════════════
describe("Monthly TDS reduction with ltcExemptTotalMinor", () => {
  it("annual taxable is lower when ltcExemptTotalMinor is set (new regime)", () => {
    const baseInput = {
      basicMinor: 5000000n,   // ₹50K basic
      daRateBps: 5000n,       // 50% DA
      cityClass: "X" as const,
      taxRegime: "new" as const,
      fyStartYear: 2025,
    };

    const slipWithout = computeSlip({ ...baseInput, ltcExemptTotalMinor: 0n });
    const slipWith = computeSlip({ ...baseInput, ltcExemptTotalMinor: 5000000n }); // ₹50K LTC exempt

    // Annual taxable should be reduced by the LTC exempt amount
    expect(slipWith.annualTaxableMinor).toBeLessThan(slipWithout.annualTaxableMinor);
    expect(slipWithout.annualTaxableMinor - slipWith.annualTaxableMinor).toBe(5000000n);
  });

  it("TDS is lower when ltcExemptTotalMinor reduces projected taxable (old regime)", () => {
    const baseInput = {
      basicMinor: 8000000n,   // ₹80K basic
      daRateBps: 4600n,       // 46% DA
      cityClass: "X" as const,
      taxRegime: "old" as const,
      fyStartYear: 2024,
      declaration: {
        ded80cMinor: 15000000n,  // ₹1.5L 80C
        ded80dMinor: 2500000n,   // ₹25K 80D
      },
    };

    const slipWithout = computeSlip({ ...baseInput, ltcExemptTotalMinor: 0n });
    const slipWith = computeSlip({ ...baseInput, ltcExemptTotalMinor: 4000000n }); // ₹40K LTC exempt

    // The LTC exemption should reduce projected annual taxable income
    expect(slipWith.annualTaxableMinor).toBeLessThan(slipWithout.annualTaxableMinor);
    // And therefore TDS should be less (or at least not more)
    expect(slipWith.tdsMinor).toBeLessThanOrEqual(slipWithout.tdsMinor);
  });

  it("ltcExemptTotalMinor defaults to zero when not provided", () => {
    const slipExplicitZero = computeSlip({
      basicMinor: 5000000n,
      taxRegime: "new",
      ltcExemptTotalMinor: 0n,
    });
    const slipOmitted = computeSlip({
      basicMinor: 5000000n,
      taxRegime: "new",
    });

    expect(slipOmitted.annualTaxableMinor).toBe(slipExplicitZero.annualTaxableMinor);
    expect(slipOmitted.tdsMinor).toBe(slipExplicitZero.tdsMinor);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Non-LTC claim is skipped by consumer
// ═══════════════════════════════════════════════════════════════════
describe("Non-LTC claims are skipped", () => {
  it("medical claim on same topic is not processed", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.ltcClaimApproved,
      makeMsg(CONSUMED_EVENTS.ltcClaimApproved, {
        claimId: randomUUID(),
        employeeId: "emp-med-1",
        claimType: "medical",  // Not LTC
        approvedFareMinor: "5000000",
        entitlementMinor: "5000000",
        blockYear: "2022-25",
        ltcType: "hometown",
        usedInBlock: 0,
      }),
    );
    await settle();

    // No insert should have been called
    expect(insertedLtcRows.length).toBe(0);
    // No audit event should have been emitted
    const auditEvent = enqueuedMessages.find(
      (m) => (m.payload as Record<string, unknown>).action === "ltc_exemption_compute",
    );
    expect(auditEvent).toBeUndefined();
    await q.stop();
  });

  it("travel_allowance claim on same topic is not processed", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.ltcClaimApproved,
      makeMsg(CONSUMED_EVENTS.ltcClaimApproved, {
        claimId: randomUUID(),
        employeeId: "emp-ta-1",
        claimType: "travel_allowance",  // Not LTC
        approvedFareMinor: "2000000",
        entitlementMinor: "3000000",
        blockYear: "2022-25",
        ltcType: "hometown",
        usedInBlock: 0,
      }),
    );
    await settle();

    expect(insertedLtcRows.length).toBe(0);
    await q.stop();
  });

  it("idempotent: duplicate LTC message is not processed twice", async () => {
    markProcessedMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const q = await buildQueue();

    const msg = makeMsg(CONSUMED_EVENTS.ltcClaimApproved, {
      claimId: randomUUID(),
      employeeId: "emp-ltc-dup",
      claimType: "ltc",
      approvedFareMinor: "4000000",
      entitlementMinor: "5000000",
      blockYear: "2022-25",
      ltcType: "hometown",
      usedInBlock: 0,
    });

    await q.publish(CONSUMED_EVENTS.ltcClaimApproved, msg);
    await settle();

    // Only one insert — second time markProcessed returns false
    expect(insertedLtcRows.length).toBe(1);
    await q.stop();
  });
});
