/**
 * Trade License payment consumer — TX-008 over-payment cap regression tests.
 *
 * Before this fix, `revenue.trade_license.payment` added the
 * client-submitted amountMinor straight to feePaidMinor with no cap at all
 * — a client could "pay" (and have persisted) any amount, including far
 * more than the license actually owed. assertPaymentWithinOutstanding
 * (domain.ts) now rejects any payment that would push feePaidMinor past
 * feeMinor, mirroring the same guard already enforced for property-tax
 * receipts (collection/domain.ts validateReceipt) and municipal bills
 * (billing-service invoices/domain.ts assertWithinOutstanding).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSet = vi.fn().mockReturnThis();
const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });
mockSet.mockReturnValue({ where: mockUpdateWhere });

const mockSelectFrom = vi.fn().mockReturnThis();
const mockSelectWhere = vi.fn().mockReturnThis();
const mockSelectLimit = vi.fn().mockResolvedValue([]);
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });
mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
mockSelectWhere.mockReturnValue({ limit: mockSelectLimit });

const mockMarkProcessed = vi.fn().mockResolvedValue(true);
const mockEnqueue = vi.fn().mockResolvedValue(undefined);
const mockCacheInvalidate = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: vi.fn(async (fn: any) => fn({ select: mockSelect, update: mockUpdate })),
  },
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: (...args: any[]) => mockCacheInvalidate(...args) },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: any[]) => mockMarkProcessed(...args),
  enqueue: (...args: any[]) => mockEnqueue(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
}));

vi.mock("../src/modules/trade-license/schema.js", () => ({
  tradeLicenses: { tenantId: "tenantId", id: "id" },
}));

// ── Import under test ─────────────────────────────────────────────────────────

import { registerTradeLicenseConsumers } from "../src/modules/trade-license/consumer.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

type SubscribeHandler = (msg: any) => Promise<void>;
const handlers: Record<string, SubscribeHandler> = {};

function createMockQueue() {
  return {
    subscribe: vi.fn((topic: string, handler: SubscribeHandler) => {
      handlers[topic] = handler;
    }),
    publish: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  } as any;
}

function buildPaymentMsg(amountMinor: string) {
  return {
    messageId: "msg-tl-payment-001",
    tenantId: "tenant-1",
    actorId: "actor-1",
    correlationId: "corr-1",
    payload: { tradeLicenseId: "license-1", amountMinor },
  };
}

function licenseRow(feeMinor: string, feePaidMinor: string) {
  return { id: "license-1", tenantId: "tenant-1", feeMinor, feePaidMinor };
}

describe("Trade License Payment Consumer — TX-008", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectLimit.mockResolvedValue([licenseRow("500000", "0")]); // fee Rs 5,000, nothing paid yet
    const queue = createMockQueue();
    registerTradeLicenseConsumers(queue);
  });

  it("applies a payment within the outstanding balance and updates status", async () => {
    const msg = buildPaymentMsg("500000"); // pays exactly the fee
    await handlers["revenue.trade_license.payment"]!(msg);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ feePaidMinor: "500000", status: "active" }),
    );
    expect(mockEnqueue).toHaveBeenCalled();
  });

  it("rejects a payment that exceeds the outstanding balance — persisted amount is never attacker-controlled", async () => {
    // Fee is 500000 (Rs 5,000), nothing paid. Client tries to "pay" 10x that.
    const msg = buildPaymentMsg("5000000");

    await expect(handlers["revenue.trade_license.payment"]!(msg)).rejects.toThrow(/OVERPAYMENT|exceeds outstanding/);

    // The over-priced amount is never written to the license row.
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("rejects a top-up payment that would push feePaidMinor past feeMinor", async () => {
    // Fee is 500000, 400000 already paid — outstanding is 100000.
    mockSelectLimit.mockResolvedValueOnce([licenseRow("500000", "400000")]);
    const msg = buildPaymentMsg("100001"); // 1 paisa over outstanding

    await expect(handlers["revenue.trade_license.payment"]!(msg)).rejects.toThrow(/OVERPAYMENT|exceeds outstanding/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects a non-positive payment amount", async () => {
    const msg = buildPaymentMsg("0");
    await expect(handlers["revenue.trade_license.payment"]!(msg)).rejects.toThrow(/INVALID_AMOUNT|positive/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("skips processing on duplicate messageId (idempotency)", async () => {
    mockMarkProcessed.mockResolvedValueOnce(false);
    const msg = buildPaymentMsg("5000000"); // would be an overpayment, but never reached
    await handlers["revenue.trade_license.payment"]!(msg);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
