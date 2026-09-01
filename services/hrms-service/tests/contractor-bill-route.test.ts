/**
 * Contractor bill route wiring — register, submit, CLRA approval gates
 * (wage-disbursement attestation, valid licence when 20+ workers), §194C TDS at
 * approval, two-person control, and the Finance-AP outbox event.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000d1";
const MAKER = "aaaaaaaa-7777-4000-8000-00000000mk01";
const CHECKER = "aaaaaaaa-7777-4000-8000-00000000ck01";
const CTR = "88888888-8888-4000-8000-000000000008";
const BILL = "99999999-9999-4000-8000-000000000009";

const H = vi.hoisted(() => ({
  findContractorMock: vi.fn(),
  findBillMock: vi.fn(),
  insertContractorMock: vi.fn(),
  insertBillMock: vi.fn(),
  updateBillMock: vi.fn(),
  ytdMock: vi.fn(),
  enqueueMock: vi.fn(),
}));

const stubTx = vi.hoisted(() => ({
  // The F3 consumer opens db.transaction() and calls markProcessed(tx, ...) first,
  // which needs insert().values().onConflictDoNothing().returning() to resolve to a
  // NON-empty array (empty means "already processed" and the consumer returns without
  // writing). The old bare `{}` tx made every consumer write silently disappear.
  insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [{ messageId: "stub" }] }) }) }),
}));

vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  db: { transaction: async (cb: (tx: unknown) => Promise<void>) => cb(stubTx), insert: () => ({ values: async () => undefined }) },
}));
vi.mock("../src/modules/contractor-bill/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  insertContractor: (...a: unknown[]) => H.insertContractorMock(...a),
  findContractor: (...a: unknown[]) => H.findContractorMock(...a),
  updateContractor: async () => undefined,
  listContractors: async () => [],
  insertBill: (...a: unknown[]) => H.insertBillMock(...a),
  findBill: (...a: unknown[]) => H.findBillMock(...a),
  updateBill: (...a: unknown[]) => H.updateBillMock(...a),
  ytdApprovedGrossTx: (...a: unknown[]) => H.ytdMock(...a.slice(1)),
  lockContractorForBilling: async () => undefined,
  listBillsByContractor: async () => [],
  listBillsByStatus: async () => [],
}));
vi.mock("../src/shared/outbox.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  enqueue: (...a: unknown[]) => H.enqueueMock(...a),
}));

import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { registerF3_contractor_bill_Consumers } from "../src/modules/contractor-bill/f3-consumer.js";

// These routes only PUBLISH; the row is written by the F3 consumer the worker
// runs. Without registering it the repo mocks below are never exercised at all,
// so the suite could not tell a working write from a crashing one.
registerF3_contractor_bill_Consumers(queue);

/** Await the in-memory queue's fan-out so the consumer's write has happened. */
async function drainF3(): Promise<void> {
  await (queue as unknown as import("@civitasone/queue").MemoryQueue).drain();
}
import { sqlClient } from "../src/shared/db.js";

const tok = (sub: string) => signToken({ sub, tid: TENANT, roles: ["hr_admin", "finance_officer"], sid: "s" }, SECRET);
const auth = (sub: string) => ({ authorization: `Bearer ${tok(sub)}` });

function contractor(over: Record<string, unknown> = {}) {
  return { id: CTR, tenantId: TENANT, name: "ACME Labour", contractorKind: "other", status: "active",
    clraLicenseNo: "CLRA/2026/1", clraLicenseValidTill: "2027-03-31", gstin: null, version: 1, ...over };
}
function bill(over: Record<string, unknown> = {}) {
  return { id: BILL, tenantId: TENANT, contractorId: CTR, billNo: "B-1", billDate: "2026-05-10",
    grossMinor: 5_000_000n, gstApplicable: true, gstRateBps: 1800, tdsSection: "194C", gstin: null,
    workersCount: 25, wagesDisbursedVerified: true, netPayableMinor: 0n,
    status: "verified", verifiedBy: MAKER, version: 1, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.findContractorMock.mockResolvedValue(contractor());
  H.ytdMock.mockResolvedValue(0n);
  H.updateBillMock.mockResolvedValue(undefined);
  H.enqueueMock.mockResolvedValue(undefined);
  H.insertContractorMock.mockResolvedValue(undefined);
  H.insertBillMock.mockResolvedValue(undefined);
});

afterAll(async () => { await sqlClient.end(); });

describe("contractor bill routes", () => {
  it("registers a contractor (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/contractors", headers: auth(MAKER),
      payload: { name: "ACME Labour", contractorKind: "other", clraLicenseNo: "CLRA/2026/1", clraLicenseValidTill: "2027-03-31" } });
    await drainF3();
    expect(r.statusCode).toBe(201);
    expect(H.insertContractorMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("submits a bill (201) — proves the RLS insert-in-transaction path", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/contractors/${CTR}/bills`, headers: auth(MAKER),
      payload: { billNo: "B-1", billDate: "2026-05-10", grossMinor: 5000000, gstApplicable: true, gstRateBps: 1800, workersCount: 25, wagesDisbursedVerified: true } });
    await drainF3();
    expect(r.statusCode).toBe(201);
    expect(H.insertBillMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("blocks approval when wage disbursement is not verified (409 CLRA_WAGES_UNVERIFIED)", async () => {
    H.findBillMock.mockResolvedValue(bill({ wagesDisbursedVerified: false }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/contractor-bills/${BILL}/approve`, headers: auth(CHECKER), payload: {} });
    await drainF3();
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("CLRA_WAGES_UNVERIFIED");
    expect(H.updateBillMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("blocks approval when 20+ workers and no valid CLRA licence (409 CLRA_LICENSE_INVALID)", async () => {
    H.findBillMock.mockResolvedValue(bill({ workersCount: 25 }));
    H.findContractorMock.mockResolvedValue(contractor({ clraLicenseNo: null, clraLicenseValidTill: null }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/contractor-bills/${BILL}/approve`, headers: auth(CHECKER), payload: {} });
    await drainF3();
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("CLRA_LICENSE_INVALID");
    await app.close();
  });

  it("computes §194C 2% TDS + 18% GST at approval and emits the AP event", async () => {
    H.findBillMock.mockResolvedValue(bill());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/contractor-bills/${BILL}/approve`, headers: auth(CHECKER), payload: {} });
    await drainF3();
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.gstMinor).toBe("900000");
    expect(b.tdsRateBps).toBe(200);
    expect(b.tdsMinor).toBe("100000");        // 2% of 50,000
    expect(b.netPayableMinor).toBe("5800000"); // 50,000 + 9,000 - 1,000
    expect(b.tdsApplied).toBe(true);
    const ev = H.enqueueMock.mock.calls[0][1];
    expect(ev.topic).toBe("hrms.contractor_bill.approved");
    expect(ev.payload.tdsMinor).toBe("100000");
    await app.close();
  });

  it("enforces two-person control (409 SOD_VIOLATION)", async () => {
    H.findBillMock.mockResolvedValue(bill({ verifiedBy: CHECKER }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/contractor-bills/${BILL}/approve`, headers: auth(CHECKER), payload: {} });
    await drainF3();
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("SOD_VIOLATION");
    await app.close();
  });

  it("marks an approved bill paid and emits the paid event", async () => {
    H.findBillMock.mockResolvedValue(bill({ status: "approved", netPayableMinor: 5_800_000n }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/contractor-bills/${BILL}/mark-paid`, headers: auth(CHECKER), payload: { paymentRef: "UTR-9" } });
    await drainF3();
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("paid");
    expect(H.enqueueMock.mock.calls[0][1].topic).toBe("hrms.contractor_bill.paid");
    await app.close();
  });
});
