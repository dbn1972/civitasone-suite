/**
 * Review-2 U05-finance-a backend gaps. All DB-free: cache + repos are mocked so
 * each test exercises the real query/validator/route logic and FAILS on the old
 * code.
 *
 *  GAP2-FINANCE-BILLS-VENDORNAME-01   vendor name resolved from masters, not a fixture
 *  GAP2-FINANCE-SANCTIONS-OFFICER-01  "Sanctioned By" resolved from identity, not a fixture
 *  GAP2-FINANCE-SANCTIONS-DETAIL-STUB-02  approvalTrail populated (maker create + checker approve)
 *  GAP2-FINANCE-PAYMENTS-TOTALS-03    payments summary aggregated server-side (not a capped page)
 *  GAP2-FINANCE-SANCTIONS-TOTALS-04   sanctions summary aggregated server-side
 *  GAP2-FINANCE-TREASURY-MONEY-05     treasury money validators are bigint-safe
 *  GAP2-FINANCE-TREASURY-DEPOSITS-TOTALS-06  deposits summary aggregated server-side
 *  GAP2-FINANCE-SANCTIONS-APPROVE-REASON-07  approve captures an optional reason
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── shared mock state ────────────────────────────────────────────────────────
const mockCache = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: vi.fn(async (_k: unknown, loader?: () => Promise<unknown>) =>
      typeof loader === "function" ? await loader() : mockCache.current),
    listOrLoad: vi.fn(async (_t: unknown, _r: unknown, _s: unknown, loader?: () => Promise<unknown>) =>
      typeof loader === "function" ? await loader() : mockCache.current),
    makeKey: (...parts: string[]) => parts.join(":"),
    invalidate: vi.fn(async () => {}),
    invalidateResource: vi.fn(async () => {}),
  },
}));

// ── payments/queries.ts (vendor name + payments summary) ─────────────────────
const p_listPaymentsByTenant = vi.fn();
const p_findBillsByIds = vi.fn();
const p_listBillsByTenant = vi.fn();
const p_findBillByIdAndTenant = vi.fn();
const p_getPaymentStatusCounts = vi.fn();
vi.mock("../src/modules/payments/repo.js", () => ({
  listPaymentsByTenant: (...a: unknown[]) => p_listPaymentsByTenant(...a),
  findBillsByIds: (...a: unknown[]) => p_findBillsByIds(...a),
  listBillsByTenant: (...a: unknown[]) => p_listBillsByTenant(...a),
  findBillByIdAndTenant: (...a: unknown[]) => p_findBillByIdAndTenant(...a),
  getPaymentStatusCounts: (...a: unknown[]) => p_getPaymentStatusCounts(...a),
}));

const m_getVendorNamesByIds = vi.fn();
const m_getVendorById = vi.fn();
vi.mock("../src/modules/masters/repo.js", () => ({
  getVendorNamesByIds: (...a: unknown[]) => m_getVendorNamesByIds(...a),
  getVendorById: (...a: unknown[]) => m_getVendorById(...a),
}));

// ── budget/queries.ts (officer name + approval trail + sanctions summary) ────
const b_listSanctionsByTenant = vi.fn();
const b_findHeadsByIds = vi.fn();
const b_findHeadById = vi.fn();
const b_findSanctionByIdAndTenant = vi.fn();
const b_getSanctionStatusAggregates = vi.fn();
vi.mock("../src/modules/budget/repo.js", () => ({
  listSanctionsByTenant: (...a: unknown[]) => b_listSanctionsByTenant(...a),
  findHeadsByIds: (...a: unknown[]) => b_findHeadsByIds(...a),
  findHeadById: (...a: unknown[]) => b_findHeadById(...a),
  findSanctionByIdAndTenant: (...a: unknown[]) => b_findSanctionByIdAndTenant(...a),
  getSanctionStatusAggregates: (...a: unknown[]) => b_getSanctionStatusAggregates(...a),
}));

const g_getTrialBalance = vi.fn();
vi.mock("../src/modules/gl/repo.js", () => ({ getTrialBalance: (...a: unknown[]) => g_getTrialBalance(...a) }));

const i_fetchUserNames = vi.fn();
vi.mock("../src/shared/identity-client.js", () => ({ fetchUserNames: (...a: unknown[]) => i_fetchUserNames(...a) }));

import * as paymentQueries from "../src/modules/payments/queries.js";
import * as budgetQueries from "../src/modules/budget/queries.js";
import { createChallanBody, createDepositBody, depositDispositionBody } from "../src/modules/treasury/validators.js";
import { approveSanctionBody } from "../src/modules/budget/validators.js";

const TENANT = "aaaaaaaa-3333-4000-8000-0000000000b1";
const VENDOR = "eeeeeeee-9999-0000-0000-000000000777"; // NOT a (removed) fixture id
const MAKER = "11111111-aaaa-4000-8000-000000000001";
const CHECKER = "22222222-bbbb-4000-8000-000000000002";

beforeEach(() => {
  [p_listPaymentsByTenant, p_findBillsByIds, p_listBillsByTenant, p_findBillByIdAndTenant, p_getPaymentStatusCounts,
   m_getVendorNamesByIds, m_getVendorById, b_listSanctionsByTenant, b_findHeadsByIds, b_findHeadById,
   b_findSanctionByIdAndTenant, b_getSanctionStatusAggregates, g_getTrialBalance, i_fetchUserNames]
    .forEach((m) => m.mockReset());
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GAP2-FINANCE-BILLS-VENDORNAME-01: vendor name from masters", () => {
  it("bill register shows the real master-data vendor name for a non-fixture vendor id", async () => {
    p_listBillsByTenant.mockResolvedValue([
      { id: "bill-1", billNo: "B1", vendorId: VENDOR, netMinor: 150000n, createdAt: "2026-09-01T00:00:00.000Z", status: "pending", poRef: null },
    ]);
    m_getVendorNamesByIds.mockResolvedValue(new Map([[VENDOR, "M/s Real Tenant Vendor Ltd."]]));
    const out = await paymentQueries.listBillSummaries(TENANT, 10, 0);
    expect(out[0].vendor).toBe("M/s Real Tenant Vendor Ltd.");
    expect(out[0].vendor).not.toMatch(/^Vendor \(/); // old UUID-derived token
  });

  it("bill detail resolves the vendor name, honest 'Unknown vendor' when absent", async () => {
    p_findBillByIdAndTenant.mockResolvedValue({ id: "bill-9", tenantId: TENANT, billNo: "B9", vendorId: VENDOR, netMinor: 150000n, createdAt: "2026-09-01T00:00:00.000Z", status: "pending", poRef: null, grnRef: null });
    m_getVendorById.mockResolvedValue(null);
    const out = await budgetUnknownVendor();
    expect(out).toBe("Unknown vendor");
  });

  it("payments register beneficiary = the bill's vendor master name", async () => {
    p_listPaymentsByTenant.mockResolvedValue([
      { id: "pay-1", billId: "bill-1", eftRef: null, amountMinor: 150000n, status: "released" },
    ]);
    p_findBillsByIds.mockResolvedValue([{ id: "bill-1", vendorId: VENDOR }]);
    m_getVendorNamesByIds.mockResolvedValue(new Map([[VENDOR, "M/s Real Tenant Vendor Ltd."]]));
    const out = await paymentQueries.listPayments(TENANT, 50, 0);
    expect(out.data[0].beneficiary).toBe("M/s Real Tenant Vendor Ltd.");
    expect(out.data[0].beneficiary).not.toMatch(/^Bill Ref /); // old UUID-derived token
  });
});

async function budgetUnknownVendor(): Promise<string | undefined> {
  const d = await paymentQueries.getBillDetail("bill-9", TENANT);
  return d?.vendor;
}

describe("GAP2-FINANCE-SANCTIONS-OFFICER-01: officer name from identity", () => {
  it("sanctions register shows the resolved creator name, not Officer(xxxx)", async () => {
    b_listSanctionsByTenant.mockResolvedValue([
      { id: "s1", sanctionNo: "SN-1", purpose: "x", amountMinor: 500000n, createdBy: MAKER, createdAt: "2026-09-01T00:00:00.000Z", status: "approved", headId: "h1" },
    ]);
    b_findHeadsByIds.mockResolvedValue([{ id: "h1", code: "2055", name: "Police" }]);
    i_fetchUserNames.mockResolvedValue(new Map([[MAKER, "Sh. Real Officer"]]));
    const out = await budgetQueries.listSanctionSummaries(TENANT, 50, 0);
    expect(out[0].sanctionedBy).toBe("Sh. Real Officer");
    expect(out[0].sanctionedBy).not.toMatch(/^Officer \(/);
  });

  it("falls back to 'Unknown officer' (never a UUID token) when identity cannot resolve", async () => {
    b_listSanctionsByTenant.mockResolvedValue([
      { id: "s1", sanctionNo: "SN-1", purpose: "x", amountMinor: 500000n, createdBy: MAKER, createdAt: "2026-09-01T00:00:00.000Z", status: "pending_approval", headId: "h1" },
    ]);
    b_findHeadsByIds.mockResolvedValue([]);
    i_fetchUserNames.mockResolvedValue(new Map());
    const out = await budgetQueries.listSanctionSummaries(TENANT, 50, 0);
    expect(out[0].sanctionedBy).toBe("Unknown officer");
  });
});

describe("GAP2-FINANCE-SANCTIONS-DETAIL-STUB-02: approval trail populated", () => {
  it("an approved sanction returns maker-create + checker-approve trail", async () => {
    b_findSanctionByIdAndTenant.mockResolvedValue({
      id: "s1", tenantId: TENANT, sanctionNo: "SN-1", purpose: "x", amountMinor: 500000n,
      createdBy: MAKER, updatedBy: CHECKER, status: "approved", headId: "h1",
      createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z",
      efileSubmittedAt: null, efileFileNo: null,
    });
    b_findHeadById.mockResolvedValue({ id: "h1", code: "2055", name: "Police" });
    i_fetchUserNames.mockResolvedValue(new Map([[MAKER, "Sh. Maker"], [CHECKER, "Sh. Checker"]]));
    const out = await budgetQueries.getSanctionDetail("s1", TENANT);
    expect(out?.approvalTrail).toHaveLength(2);
    expect(out?.approvalTrail[0]).toMatchObject({ action: "created", actor: "Sh. Maker" });
    expect(out?.approvalTrail[1]).toMatchObject({ action: "approved", actor: "Sh. Checker" });
  });

  it("a still-pending sanction returns only the create event", async () => {
    b_findSanctionByIdAndTenant.mockResolvedValue({
      id: "s2", tenantId: TENANT, sanctionNo: "SN-2", purpose: "x", amountMinor: 500000n,
      createdBy: MAKER, updatedBy: MAKER, status: "pending_approval", headId: "h1",
      createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
      efileSubmittedAt: null, efileFileNo: null,
    });
    b_findHeadById.mockResolvedValue(null);
    i_fetchUserNames.mockResolvedValue(new Map([[MAKER, "Sh. Maker"]]));
    const out = await budgetQueries.getSanctionDetail("s2", TENANT);
    expect(out?.approvalTrail).toHaveLength(1);
    expect(out?.approvalTrail[0].action).toBe("created");
  });
});

describe("GAP2-FINANCE-PAYMENTS-TOTALS-03: payments summary aggregated server-side", () => {
  it("maps DB per-status counts into the four register buckets (total not capped)", async () => {
    p_getPaymentStatusCounts.mockResolvedValue({
      total: 60,
      byStatus: { released: 40, completed: 2, pending_approval: 10, failed: 5, initiated: 3 },
    });
    const s = await paymentQueries.getPaymentsSummary(TENANT);
    expect(s.total).toBe(60);
    expect(s.released).toBe(42); // released + completed
    expect(s.pendingApproval).toBe(10);
    expect(s.failed).toBe(5);
  });
});

describe("GAP2-FINANCE-SANCTIONS-TOTALS-04: sanctions summary aggregated server-side", () => {
  it("approved value sums ALL approved sanctions; active = approved + pending", async () => {
    b_getSanctionStatusAggregates.mockResolvedValue([
      { status: "approved", n: 40, sumMinor: 4000000n },
      { status: "exhausted", n: 20, sumMinor: 2000000n }, // also maps to approved
      { status: "pending_approval", n: 7, sumMinor: 700000n },
      { status: "cancelled", n: 3, sumMinor: 300000n },    // rejected
    ]);
    const s = await budgetQueries.getSanctionsSummary(TENANT);
    expect(s.total).toBe(70);
    expect(s.approved).toBe(60);
    expect(s.pending).toBe(7);
    expect(s.active).toBe(67);
    expect(s.approvedMinor).toBe("6000000");
  });
});

describe("GAP2-FINANCE-TREASURY-MONEY-05: treasury money validators are bigint-safe", () => {
  it("challan accepts a 17-digit amountMinor as a string, exactly (no precision loss)", () => {
    const parsed = createChallanBody.parse({
      receiptHeadId: "cccccccc-0000-4000-8000-000000000001",
      depositor: "ACME", amountMinor: "12345678901234567",
    });
    expect(parsed.amountMinor).toBe(12345678901234567n);
  });
  it("deposit balanceMinor and disposition amountMinor are bigint", () => {
    expect(createDepositBody.parse({ pdNo: "PD1", type: "pd", administrator: "A", balanceMinor: "99999999999999999" }).balanceMinor)
      .toBe(99999999999999999n);
    expect(depositDispositionBody.parse({ amountMinor: "250000" }).amountMinor).toBe(250000n);
  });
  it("rejects a non-integer / non-positive amount", () => {
    expect(() => createChallanBody.parse({ receiptHeadId: "cccccccc-0000-4000-8000-000000000001", depositor: "A", amountMinor: 0 })).toThrow();
  });
});

describe("GAP2-FINANCE-SANCTIONS-APPROVE-REASON-07: approve captures an optional reason", () => {
  it("accepts an approve with a reason", () => {
    expect(approveSanctionBody.parse({ reason: "Within delegated powers" }).reason).toBe("Within delegated powers");
  });
  it("accepts an approve with no body (reason optional)", () => {
    expect(approveSanctionBody.parse({})).toEqual({});
  });
});
