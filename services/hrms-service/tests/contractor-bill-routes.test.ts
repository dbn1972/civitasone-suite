/**
 * Contractor-bill route-level tests — comprehensive coverage:
 * happy paths, 400 validation, 401 unauthenticated, 403 forbidden,
 * 404 not found, 409 conflict / CLRA gates / SOD.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const MAKER = "aaaaaaaa-2222-4000-8000-000000000002";
const CHECKER = "aaaaaaaa-3333-4000-8000-000000000003";
const CTR_ID = "cccccccc-2222-4000-8000-000000000002";
const BILL_ID = "dddddddd-2222-4000-8000-000000000002";

const H = vi.hoisted(() => ({
  findContractorMock: vi.fn(),
  findBillMock: vi.fn(),
  insertContractorMock: vi.fn(),
  insertBillMock: vi.fn(),
  updateContractorMock: vi.fn(),
  updateBillMock: vi.fn(),
  ytdMock: vi.fn(),
  enqueueMock: vi.fn(),
  listContractorsMock: vi.fn(),
  listBillsByContractorMock: vi.fn(),
  listBillsByStatusMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock("../src/modules/contractor-bill/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  insertContractor: (...a: unknown[]) => H.insertContractorMock(...a),
  findContractor: (...a: unknown[]) => H.findContractorMock(...a),
  updateContractor: (...a: unknown[]) => H.updateContractorMock(...a),
  listContractors: (...a: unknown[]) => H.listContractorsMock(...a),
  insertBill: (...a: unknown[]) => H.insertBillMock(...a),
  findBill: (...a: unknown[]) => H.findBillMock(...a),
  updateBill: (...a: unknown[]) => H.updateBillMock(...a),
  ytdApprovedGrossTx: (...a: unknown[]) => H.ytdMock(...a.slice(1)),
  lockContractorForBilling: async () => undefined,
  listBillsByContractor: (...a: unknown[]) => H.listBillsByContractorMock(...a),
  listBillsByStatus: (...a: unknown[]) => H.listBillsByStatusMock(...a),
}));
vi.mock("../src/shared/outbox.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  enqueue: (...a: unknown[]) => H.enqueueMock(...a),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const tok = (sub = USER, roles = ["hr_admin"]) =>
  signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) =>
  ({ authorization: `Bearer ${tok(sub, roles)}` });

function contractor(over: Record<string, unknown> = {}) {
  return {
    id: CTR_ID, tenantId: TENANT, name: "ACME Labour Services",
    contractorKind: "other", status: "active",
    clraLicenseNo: "CLRA/2026/01", clraLicenseValidTill: "2027-03-31",
    gstin: "29AABCU9603R1ZP", pan: "AABCU9603R",
    contactEmail: "acme@example.com", contactPhone: "9876543210",
    version: 1, ...over,
  };
}

function bill(over: Record<string, unknown> = {}) {
  return {
    id: BILL_ID, tenantId: TENANT, contractorId: CTR_ID,
    billNo: "BILL-001", billDate: "2026-06-15",
    grossMinor: 5_000_000n, gstApplicable: true, gstRateBps: 1800,
    tdsSection: "194C", gstin: "29AABCU9603R1ZP",
    workersCount: 25, wagesDisbursedVerified: true,
    netPayableMinor: 0n,
    status: "submitted", verifiedBy: null, version: 1,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.findContractorMock.mockResolvedValue(contractor());
  H.findBillMock.mockResolvedValue(bill());
  H.insertContractorMock.mockResolvedValue(undefined);
  H.insertBillMock.mockResolvedValue(undefined);
  H.updateContractorMock.mockResolvedValue(undefined);
  H.updateBillMock.mockResolvedValue(undefined);
  H.ytdMock.mockResolvedValue(0n);
  H.enqueueMock.mockResolvedValue(undefined);
  H.listContractorsMock.mockResolvedValue([]);
  H.listBillsByContractorMock.mockResolvedValue([]);
  H.listBillsByStatusMock.mockResolvedValue([]);
});

afterAll(async () => { await sqlClient.end(); });

describe("POST /v1/hrms/contractors (register)", () => {
  it("201 — registers a contractor", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/contractors",
      headers: auth(MAKER), payload: { name: "ACME Labour", contractorKind: "other", clraLicenseNo: "CLRA/2026/01", clraLicenseValidTill: "2027-03-31" },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().name).toBe("ACME Labour");
    expect(r.json().status).toBe("active");
    expect(H.insertContractorMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("400 — missing name", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/contractors",
      headers: auth(MAKER), payload: {},
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("400 — invalid license date format", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/contractors",
      headers: auth(MAKER), payload: { name: "X", clraLicenseValidTill: "31-03-2027" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/contractors", payload: { name: "X" } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — non-finance role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/contractors",
      headers: auth(USER, ["employee"]), payload: { name: "X" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/hrms/contractors (list)", () => {
  it("200 — returns list", async () => {
    H.listContractorsMock.mockResolvedValue([contractor()]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/contractors", headers: auth(MAKER) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/contractors" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — wrong role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/contractors", headers: auth(USER, ["viewer"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/hrms/contractors/:id (read single)", () => {
  it("200 — returns contractor", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/contractors/${CTR_ID}`, headers: auth(MAKER) });
    expect(r.statusCode).toBe(200);
    expect(r.json().name).toBe("ACME Labour Services");
    await app.close();
  });

  it("400 — invalid UUID", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/contractors/bad-uuid", headers: auth(MAKER) });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/contractors/${CTR_ID}` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("404 — not found", async () => {
    H.findContractorMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/contractors/${CTR_ID}`, headers: auth(MAKER) });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });
});

describe("PATCH /v1/hrms/contractors/:id (update)", () => {
  it("200 — updates contractor fields", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/contractors/${CTR_ID}`,
      headers: auth(MAKER), payload: { status: "blacklisted" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("blacklisted");
    expect(H.updateContractorMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("400 — invalid status value", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/contractors/${CTR_ID}`,
      headers: auth(MAKER), payload: { status: "invalid_status" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/contractors/${CTR_ID}`, payload: {} });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — non-finance role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/contractors/${CTR_ID}`,
      headers: auth(USER, ["employee"]), payload: { status: "active" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — contractor not found", async () => {
    H.findContractorMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/contractors/${CTR_ID}`,
      headers: auth(MAKER), payload: { status: "active" },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

describe("POST /v1/hrms/contractors/:id/bills (submit bill)", () => {
  it("201 — submits a bill", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractors/${CTR_ID}/bills`,
      headers: auth(MAKER), payload: { billNo: "BILL-001", billDate: "2026-06-15", grossMinor: 5000000, gstApplicable: true, gstRateBps: 1800, workersCount: 25, wagesDisbursedVerified: true },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().billNo).toBe("BILL-001");
    expect(r.json().status).toBe("submitted");
    expect(H.insertBillMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("400 — missing billNo", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractors/${CTR_ID}/bills`,
      headers: auth(MAKER), payload: { billDate: "2026-06-15", grossMinor: 1000 },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("400 — invalid billDate format", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractors/${CTR_ID}/bills`,
      headers: auth(MAKER), payload: { billNo: "B-1", billDate: "15/06/2026", grossMinor: 1000 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — grossMinor must be positive", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractors/${CTR_ID}/bills`,
      headers: auth(MAKER), payload: { billNo: "B-1", billDate: "2026-06-15", grossMinor: 0 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractors/${CTR_ID}/bills`,
      payload: { billNo: "B-1", billDate: "2026-06-15", grossMinor: 1000 },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — wrong role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractors/${CTR_ID}/bills`,
      headers: auth(USER, ["viewer"]), payload: { billNo: "B-1", billDate: "2026-06-15", grossMinor: 1000 },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — contractor not found", async () => {
    H.findContractorMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractors/${CTR_ID}/bills`,
      headers: auth(MAKER), payload: { billNo: "B-1", billDate: "2026-06-15", grossMinor: 1000 },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("409 — blacklisted contractor", async () => {
    H.findContractorMock.mockResolvedValue(contractor({ status: "blacklisted" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractors/${CTR_ID}/bills`,
      headers: auth(MAKER), payload: { billNo: "B-1", billDate: "2026-06-15", grossMinor: 1000 },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("CONTRACTOR_BLACKLISTED");
    await app.close();
  });

  it("409 — duplicate bill number", async () => {
    H.insertBillMock.mockRejectedValue(Object.assign(new Error("dup"), { code: "23505" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractors/${CTR_ID}/bills`,
      headers: auth(MAKER), payload: { billNo: "BILL-001", billDate: "2026-06-15", grossMinor: 1000 },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("DUPLICATE_BILL");
    await app.close();
  });
});

describe("GET /v1/hrms/contractors/:id/bills (list by contractor)", () => {
  it("200 — returns bill list", async () => {
    H.listBillsByContractorMock.mockResolvedValue([bill()]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/contractors/${CTR_ID}/bills`, headers: auth(MAKER) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/contractors/${CTR_ID}/bills` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("GET /v1/hrms/contractor-bills (AP queue)", () => {
  it("200 — returns bills by status", async () => {
    H.listBillsByStatusMock.mockResolvedValue([bill()]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/contractor-bills?status=submitted", headers: auth(MAKER) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });

  it("400 — invalid status", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/contractor-bills?status=bogus", headers: auth(MAKER) });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/contractor-bills" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — non-finance role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/contractor-bills", headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/hrms/contractor-bills/:billId (read single)", () => {
  it("200 — returns the bill", async () => {
    H.findBillMock.mockResolvedValue(bill());
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/contractor-bills/${BILL_ID}`, headers: auth(MAKER) });
    expect(r.statusCode).toBe(200);
    expect(r.json().billNo).toBe("BILL-001");
    await app.close();
  });

  it("400 — invalid UUID", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/contractor-bills/not-uuid", headers: auth(MAKER) });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/contractor-bills/${BILL_ID}` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("404 — bill not found", async () => {
    H.findBillMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/contractor-bills/${BILL_ID}`, headers: auth(MAKER) });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });
});

describe("POST /v1/hrms/contractor-bills/:billId/verify", () => {
  it("200 — verifies a submitted bill", async () => {
    H.findBillMock.mockResolvedValue(bill({ status: "submitted" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/verify`,
      headers: auth(MAKER),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("verified");
    expect(H.updateBillMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/verify` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — non-finance role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/verify`,
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — bill not found", async () => {
    H.findBillMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/verify`,
      headers: auth(MAKER),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("409 — wrong state (not submitted)", async () => {
    H.findBillMock.mockResolvedValue(bill({ status: "approved" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/verify`,
      headers: auth(MAKER),
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STATE");
    await app.close();
  });
});

describe("POST /v1/hrms/contractor-bills/:billId/approve", () => {
  it("200 — approves with §194C TDS + GST", async () => {
    H.findBillMock.mockResolvedValue(bill({ status: "verified", verifiedBy: MAKER }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/approve`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.status).toBe("approved");
    // GST: 5,000,000 * 1800 / 10000 = 900,000
    expect(body.gstMinor).toBe("900000");
    // TDS: 2% for "other" = 200 bps → 5,000,000 * 200 / 10000 = 100,000
    expect(body.tdsRateBps).toBe(200);
    expect(body.tdsMinor).toBe("100000");
    // Net: 5,000,000 + 900,000 - 100,000 = 5,800,000
    expect(body.netPayableMinor).toBe("5800000");
    expect(body.tdsApplied).toBe(true);
    expect(H.enqueueMock).toHaveBeenCalledOnce();
    const ev = H.enqueueMock.mock.calls[0][1];
    expect(ev.topic).toBe("hrms.contractor_bill.approved");
    await app.close();
  });

  it("200 — 1% TDS for individual/HUF contractor", async () => {
    H.findBillMock.mockResolvedValue(bill({ status: "verified", verifiedBy: MAKER }));
    H.findContractorMock.mockResolvedValue(contractor({ contractorKind: "individual_huf" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/approve`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().tdsRateBps).toBe(100);
    // TDS: 5,000,000 * 100 / 10000 = 50,000
    expect(r.json().tdsMinor).toBe("50000");
    await app.close();
  });

  it("200 — no TDS when below both thresholds", async () => {
    // Single < 30k AND annual < 1L
    H.findBillMock.mockResolvedValue(bill({ status: "verified", verifiedBy: MAKER, grossMinor: 100_000n, gstApplicable: false }));
    H.ytdMock.mockResolvedValue(0n);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/approve`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().tdsApplied).toBe(false);
    expect(r.json().tdsMinor).toBe("0");
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/approve`, payload: {} });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — non-finance role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/approve`,
      headers: auth(USER, ["employee"]), payload: {},
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — bill not found", async () => {
    H.findBillMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/approve`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("409 — wrong state (not verified)", async () => {
    H.findBillMock.mockResolvedValue(bill({ status: "submitted" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/approve`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STATE");
    await app.close();
  });

  it("409 — SOD violation (approver = verifier)", async () => {
    H.findBillMock.mockResolvedValue(bill({ status: "verified", verifiedBy: CHECKER }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/approve`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("SOD_VIOLATION");
    expect(H.updateBillMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("409 — contractor blacklisted at approval", async () => {
    H.findBillMock.mockResolvedValue(bill({ status: "verified", verifiedBy: MAKER }));
    H.findContractorMock.mockResolvedValue(contractor({ status: "blacklisted" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/approve`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("CONTRACTOR_BLACKLISTED");
    await app.close();
  });

  it("409 — CLRA wages not verified", async () => {
    H.findBillMock.mockResolvedValue(bill({ status: "verified", verifiedBy: MAKER, wagesDisbursedVerified: false }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/approve`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("CLRA_WAGES_UNVERIFIED");
    await app.close();
  });

  it("409 — CLRA licence invalid (20+ workers, no licence)", async () => {
    H.findBillMock.mockResolvedValue(bill({ status: "verified", verifiedBy: MAKER, workersCount: 25 }));
    H.findContractorMock.mockResolvedValue(contractor({ clraLicenseNo: null, clraLicenseValidTill: null }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/approve`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("CLRA_LICENSE_INVALID");
    await app.close();
  });

  it("409 — CLRA licence expired", async () => {
    H.findBillMock.mockResolvedValue(bill({ status: "verified", verifiedBy: MAKER, workersCount: 20, billDate: "2026-06-15" }));
    H.findContractorMock.mockResolvedValue(contractor({ clraLicenseNo: "CLRA/1", clraLicenseValidTill: "2025-12-31" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/approve`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("CLRA_LICENSE_INVALID");
    await app.close();
  });

  it("200 — CLRA licence check skipped when workers < 20", async () => {
    H.findBillMock.mockResolvedValue(bill({ status: "verified", verifiedBy: MAKER, workersCount: 19 }));
    H.findContractorMock.mockResolvedValue(contractor({ clraLicenseNo: null, clraLicenseValidTill: null }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/approve`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});

describe("POST /v1/hrms/contractor-bills/:billId/reject", () => {
  it("200 — rejects a submitted bill", async () => {
    H.findBillMock.mockResolvedValue(bill({ status: "submitted" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/reject`,
      headers: auth(CHECKER), payload: { approverRemarks: "Incomplete" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("rejected");
    await app.close();
  });

  it("200 — rejects a verified bill", async () => {
    H.findBillMock.mockResolvedValue(bill({ status: "verified" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/reject`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("rejected");
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/reject`, payload: {} });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — non-finance role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/reject`,
      headers: auth(USER, ["employee"]), payload: {},
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — bill not found", async () => {
    H.findBillMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/reject`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("409 — wrong state (approved cannot be rejected)", async () => {
    H.findBillMock.mockResolvedValue(bill({ status: "approved" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/reject`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STATE");
    await app.close();
  });
});

describe("POST /v1/hrms/contractor-bills/:billId/mark-paid", () => {
  it("200 — marks an approved bill as paid", async () => {
    H.findBillMock.mockResolvedValue(bill({ status: "approved", netPayableMinor: 5_800_000n }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/mark-paid`,
      headers: auth(CHECKER), payload: { paymentRef: "UTR-123" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("paid");
    expect(r.json().paymentRef).toBe("UTR-123");
    expect(H.enqueueMock).toHaveBeenCalledOnce();
    const ev = H.enqueueMock.mock.calls[0][1];
    expect(ev.topic).toBe("hrms.contractor_bill.paid");
    await app.close();
  });

  it("400 — missing paymentRef", async () => {
    H.findBillMock.mockResolvedValue(bill({ status: "approved" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/mark-paid`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/mark-paid`, payload: { paymentRef: "X" } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — non-finance role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/mark-paid`,
      headers: auth(USER, ["employee"]), payload: { paymentRef: "X" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — bill not found", async () => {
    H.findBillMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/mark-paid`,
      headers: auth(CHECKER), payload: { paymentRef: "X" },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("409 — wrong state (not approved)", async () => {
    H.findBillMock.mockResolvedValue(bill({ status: "verified" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${BILL_ID}/mark-paid`,
      headers: auth(CHECKER), payload: { paymentRef: "X" },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STATE");
    await app.close();
  });
});
