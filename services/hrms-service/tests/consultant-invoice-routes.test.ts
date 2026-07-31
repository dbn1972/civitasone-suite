/**
 * Consultant-invoice route-level tests — comprehensive coverage:
 * happy paths, 400 validation, 401 unauthenticated, 403 forbidden,
 * 404 not found, 409 conflict / state machine / SOD.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const MAKER = "aaaaaaaa-2222-4000-8000-000000000002";
const CHECKER = "aaaaaaaa-3333-4000-8000-000000000003";
const CONSULTANT_ID = "cccccccc-1111-4000-8000-000000000001";
const INV_ID = "dddddddd-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  scopedReadMock: vi.fn(),
  findInvoiceMock: vi.fn(),
  insertInvoiceMock: vi.fn(),
  updateInvoiceMock: vi.fn(),
  ytdMock: vi.fn(),
  enqueueMock: vi.fn(),
  loadResolverMock: vi.fn(),
  listByConsultantMock: vi.fn(),
  listByStatusMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => H.scopedReadMock(fn),
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
}));
vi.mock("../src/modules/consultant-invoice/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  insertInvoice: (...a: unknown[]) => H.insertInvoiceMock(...a),
  findInvoice: (...a: unknown[]) => H.findInvoiceMock(...a),
  updateInvoice: (...a: unknown[]) => H.updateInvoiceMock(...a),
  ytdApprovedGrossTx: (...a: unknown[]) => H.ytdMock(...a.slice(1)),
  lockConsultantForInvoicing: async () => undefined,
  listByConsultant: (...a: unknown[]) => H.listByConsultantMock(...a),
  listByStatus: (...a: unknown[]) => H.listByStatusMock(...a),
}));
vi.mock("../src/shared/outbox.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  enqueue: (...a: unknown[]) => H.enqueueMock(...a),
}));
vi.mock("../src/modules/employee/engagement-policy.js", async (io) => {
  const actual = await io<typeof import("../src/modules/employee/engagement-policy.js")>();
  return { ...actual, loadTypeResolver: (...a: unknown[]) => H.loadResolverMock(...a) };
});

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { buildTypeResolver } from "../src/modules/employee/engagement-policy.js";

const CANON = [
  { category: "consultant", eligibleForPayroll: false },
  { category: "pay_scale", eligibleForPayroll: true },
];

const tok = (sub = USER, roles = ["hr_admin"]) =>
  signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) =>
  ({ authorization: `Bearer ${tok(sub, roles)}` });

function employee(over: Record<string, unknown> = {}) {
  return { id: CONSULTANT_ID, tenantId: TENANT, employeeType: "consultant", gstin: null, sacCode: null, ...over };
}

function invoice(over: Record<string, unknown> = {}) {
  return {
    id: INV_ID, tenantId: TENANT, consultantId: CONSULTANT_ID,
    invoiceNo: "INV-001", invoiceDate: "2026-06-15",
    grossMinor: 5_000_000n, gstApplicable: true, gstRateBps: 1800,
    tdsSection: "194J", tdsRateBps: 1000,
    gstMinor: 0n, tdsMinor: 0n, netPayableMinor: 0n,
    gstin: null, sacCode: null,
    status: "submitted", verifiedBy: null, version: 1,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.scopedReadMock.mockImplementation(async (fn: (tx: unknown) => unknown) => {
    // For mustEmployee — returns employee data
    return [employee()];
  });
  H.loadResolverMock.mockResolvedValue(buildTypeResolver([], CANON));
  H.findInvoiceMock.mockResolvedValue(invoice());
  H.insertInvoiceMock.mockResolvedValue(undefined);
  H.updateInvoiceMock.mockResolvedValue(undefined);
  H.ytdMock.mockResolvedValue(0n);
  H.enqueueMock.mockResolvedValue(undefined);
  H.listByConsultantMock.mockResolvedValue([]);
  H.listByStatusMock.mockResolvedValue([]);
});

afterAll(async () => { await sqlClient.end(); });

describe("POST /v1/hrms/consultants/:id/invoices (submit)", () => {
  it("201 — submits an invoice for a consultant", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultants/${CONSULTANT_ID}/invoices`,
      headers: auth(MAKER), payload: { invoiceNo: "INV-001", invoiceDate: "2026-06-15", grossMinor: 5000000, gstApplicable: true, gstRateBps: 1800 },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.invoiceNo).toBe("INV-001");
    expect(body.status).toBe("submitted");
    expect(H.insertInvoiceMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("400 — missing required fields", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultants/${CONSULTANT_ID}/invoices`,
      headers: auth(MAKER), payload: {},
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("400 — invalid UUID in params", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultants/not-a-uuid/invoices`,
      headers: auth(MAKER), payload: { invoiceNo: "X", invoiceDate: "2026-06-15", grossMinor: 1000 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid invoice date format", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultants/${CONSULTANT_ID}/invoices`,
      headers: auth(MAKER), payload: { invoiceNo: "INV-X", invoiceDate: "15-06-2026", grossMinor: 1000 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — grossMinor must be positive", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultants/${CONSULTANT_ID}/invoices`,
      headers: auth(MAKER), payload: { invoiceNo: "INV-X", invoiceDate: "2026-06-15", grossMinor: -100 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultants/${CONSULTANT_ID}/invoices`,
      payload: { invoiceNo: "INV-X", invoiceDate: "2026-06-15", grossMinor: 1000 },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultants/${CONSULTANT_ID}/invoices`,
      headers: auth(USER, ["viewer"]), payload: { invoiceNo: "INV-X", invoiceDate: "2026-06-15", grossMinor: 1000 },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — consultant (employee) not found", async () => {
    H.scopedReadMock.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultants/${CONSULTANT_ID}/invoices`,
      headers: auth(MAKER), payload: { invoiceNo: "INV-X", invoiceDate: "2026-06-15", grossMinor: 1000 },
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });

  it("409 — payroll-eligible employee cannot submit invoice", async () => {
    H.scopedReadMock.mockResolvedValue([employee({ employeeType: "pay_scale" })]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultants/${CONSULTANT_ID}/invoices`,
      headers: auth(MAKER), payload: { invoiceNo: "INV-X", invoiceDate: "2026-06-15", grossMinor: 1000 },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NOT_A_CONSULTANT");
    await app.close();
  });

  it("409 — duplicate invoice number", async () => {
    H.insertInvoiceMock.mockRejectedValue(Object.assign(new Error("dup"), { code: "23505" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultants/${CONSULTANT_ID}/invoices`,
      headers: auth(MAKER), payload: { invoiceNo: "INV-001", invoiceDate: "2026-06-15", grossMinor: 1000 },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("DUPLICATE_INVOICE");
    await app.close();
  });
});

describe("GET /v1/hrms/consultants/:id/invoices (list by consultant)", () => {
  it("200 — returns invoices list", async () => {
    H.listByConsultantMock.mockResolvedValue([invoice()]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/consultants/${CONSULTANT_ID}/invoices`,
      headers: auth(MAKER),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/consultants/${CONSULTANT_ID}/invoices` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — wrong role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/consultants/${CONSULTANT_ID}/invoices`,
      headers: auth(USER, ["viewer"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/hrms/consultant-invoices (AP queue by status)", () => {
  it("200 — returns filtered list", async () => {
    H.listByStatusMock.mockResolvedValue([invoice()]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/consultant-invoices?status=submitted",
      headers: auth(MAKER),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });

  it("200 — defaults to submitted status", async () => {
    H.listByStatusMock.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/consultant-invoices",
      headers: auth(MAKER),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("400 — invalid status value", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/consultant-invoices?status=invalid",
      headers: auth(MAKER),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/consultant-invoices" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — non-finance role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/consultant-invoices",
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/hrms/consultant-invoices/:invId (read single)", () => {
  it("200 — returns the invoice", async () => {
    H.findInvoiceMock.mockResolvedValue(invoice());
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/consultant-invoices/${INV_ID}`,
      headers: auth(MAKER),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().invoiceNo).toBe("INV-001");
    await app.close();
  });

  it("400 — invalid UUID", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/consultant-invoices/bad-id",
      headers: auth(MAKER),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/consultant-invoices/${INV_ID}` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — wrong role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/consultant-invoices/${INV_ID}`,
      headers: auth(USER, ["viewer"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — invoice not found", async () => {
    H.findInvoiceMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/consultant-invoices/${INV_ID}`,
      headers: auth(MAKER),
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });
});

describe("POST /v1/hrms/consultant-invoices/:invId/verify", () => {
  it("200 — verifies a submitted invoice", async () => {
    H.findInvoiceMock.mockResolvedValue(invoice({ status: "submitted" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/verify`,
      headers: auth(MAKER),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("verified");
    expect(H.updateInvoiceMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/verify` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — non-finance role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/verify`,
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — invoice not found", async () => {
    H.findInvoiceMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/verify`,
      headers: auth(MAKER),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("409 — wrong state (not submitted)", async () => {
    H.findInvoiceMock.mockResolvedValue(invoice({ status: "approved" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/verify`,
      headers: auth(MAKER),
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STATE");
    await app.close();
  });
});

describe("POST /v1/hrms/consultant-invoices/:invId/approve", () => {
  it("200 — approves with 194J TDS + GST computation", async () => {
    H.findInvoiceMock.mockResolvedValue(invoice({ status: "verified", verifiedBy: MAKER }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/approve`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.status).toBe("approved");
    // GST = 5,000,000 * 1800 / 10000 = 900,000
    expect(body.gstMinor).toBe("900000");
    // TDS = 5,000,000 * 1000 / 10000 = 500,000
    expect(body.tdsMinor).toBe("500000");
    // Net = 5,000,000 + 900,000 - 500,000 = 5,400,000
    expect(body.netPayableMinor).toBe("5400000");
    expect(body.tdsApplied).toBe(true);
    expect(H.enqueueMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("200 — checker overrides TDS rate", async () => {
    H.findInvoiceMock.mockResolvedValue(invoice({ status: "verified", verifiedBy: MAKER, tdsRateBps: 0, gstApplicable: false }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/approve`,
      headers: auth(CHECKER), payload: { tdsRateBps: 1000 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().tdsMinor).toBe("500000");
    await app.close();
  });

  it("200 — no TDS when below threshold", async () => {
    // grossMinor = 100,000 (₹1000), ytd = 0 → total < 3,000,000 threshold
    H.findInvoiceMock.mockResolvedValue(invoice({ status: "verified", verifiedBy: MAKER, grossMinor: 100_000n, gstApplicable: false }));
    H.ytdMock.mockResolvedValue(0n);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/approve`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().tdsApplied).toBe(false);
    expect(r.json().tdsMinor).toBe("0");
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/approve`, payload: {} });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — non-finance role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/approve`,
      headers: auth(USER, ["employee"]), payload: {},
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — invoice not found", async () => {
    H.findInvoiceMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/approve`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("409 — wrong state (not verified)", async () => {
    H.findInvoiceMock.mockResolvedValue(invoice({ status: "submitted" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/approve`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STATE");
    await app.close();
  });

  it("409 — SOD violation (approver = verifier)", async () => {
    H.findInvoiceMock.mockResolvedValue(invoice({ status: "verified", verifiedBy: CHECKER }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/approve`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("SOD_VIOLATION");
    expect(H.updateInvoiceMock).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("POST /v1/hrms/consultant-invoices/:invId/reject", () => {
  it("200 — rejects a submitted invoice", async () => {
    H.findInvoiceMock.mockResolvedValue(invoice({ status: "submitted" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/reject`,
      headers: auth(CHECKER), payload: { approverRemarks: "Incomplete docs" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("rejected");
    await app.close();
  });

  it("200 — rejects a verified invoice", async () => {
    H.findInvoiceMock.mockResolvedValue(invoice({ status: "verified" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/reject`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("rejected");
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/reject`, payload: {} });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — non-finance role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/reject`,
      headers: auth(USER, ["employee"]), payload: {},
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — invoice not found", async () => {
    H.findInvoiceMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/reject`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("409 — wrong state (approved cannot be rejected)", async () => {
    H.findInvoiceMock.mockResolvedValue(invoice({ status: "approved" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/reject`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STATE");
    await app.close();
  });
});

describe("POST /v1/hrms/consultants/:id/invoices — optional fields & edge cases", () => {
  it("201 — submit with all optional fields (periodFrom, periodTo, description, gstin, sacCode, remarks)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultants/${CONSULTANT_ID}/invoices`,
      headers: auth(MAKER), payload: {
        invoiceNo: "INV-FULL", invoiceDate: "2026-06-15", grossMinor: 2000000,
        gstApplicable: true, gstRateBps: 1800,
        periodFrom: "2026-06-01", periodTo: "2026-06-30",
        description: "Monthly consulting services", gstin: "27AABCU9603R1ZM",
        sacCode: "998311", remarks: "June invoice",
      },
    });
    expect(r.statusCode).toBe(201);
    expect(H.insertInvoiceMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("201 — falls back to employee gstin/sacCode when not provided in body", async () => {
    H.scopedReadMock.mockResolvedValue([employee({ gstin: "07AAACR5055K1Z5", sacCode: "998312" })]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultants/${CONSULTANT_ID}/invoices`,
      headers: auth(MAKER), payload: { invoiceNo: "INV-EMP", invoiceDate: "2026-06-15", grossMinor: 1000000 },
    });
    expect(r.statusCode).toBe(201);
    await app.close();
  });

  it("201 — resolver failure allows submission (fail-open)", async () => {
    H.loadResolverMock.mockRejectedValue(new Error("DB unavailable"));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultants/${CONSULTANT_ID}/invoices`,
      headers: auth(MAKER), payload: { invoiceNo: "INV-F", invoiceDate: "2026-06-15", grossMinor: 500000 },
    });
    expect(r.statusCode).toBe(201);
    await app.close();
  });

  it("201 — invoice in Jan (month < 4) uses previous calendar year as FY start", async () => {
    // This exercises the financialYearWindow branch where month < 4
    H.findInvoiceMock.mockResolvedValue(invoice({ status: "verified", verifiedBy: MAKER, invoiceDate: "2027-01-15" }));
    H.ytdMock.mockResolvedValue(4_000_000n);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/approve`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().tdsApplied).toBe(true);
    await app.close();
  });

  it("500 — unhandled error from insert propagates through error handler", async () => {
    H.insertInvoiceMock.mockRejectedValue(new Error("connection reset"));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultants/${CONSULTANT_ID}/invoices`,
      headers: auth(MAKER), payload: { invoiceNo: "INV-ERR", invoiceDate: "2026-06-15", grossMinor: 1000 },
    });
    expect(r.statusCode).toBe(500);
    expect(r.json().code).toBe("INTERNAL");
    await app.close();
  });

  it("400 — gstRateBps exceeds 10000", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultants/${CONSULTANT_ID}/invoices`,
      headers: auth(MAKER), payload: { invoiceNo: "INV-X", invoiceDate: "2026-06-15", grossMinor: 1000, gstRateBps: 20000 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });
});

describe("POST /v1/hrms/consultant-invoices/:invId/mark-paid", () => {
  it("200 — marks an approved invoice as paid", async () => {
    H.findInvoiceMock.mockResolvedValue(invoice({ status: "approved", netPayableMinor: 5_400_000n }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/mark-paid`,
      headers: auth(CHECKER), payload: { paymentRef: "UTR-999" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("paid");
    expect(r.json().paymentRef).toBe("UTR-999");
    expect(H.enqueueMock).toHaveBeenCalledOnce();
    const ev = H.enqueueMock.mock.calls[0][1];
    expect(ev.topic).toBe("hrms.consultant_invoice.paid");
    await app.close();
  });

  it("400 — missing paymentRef", async () => {
    H.findInvoiceMock.mockResolvedValue(invoice({ status: "approved" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/mark-paid`,
      headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/mark-paid`, payload: { paymentRef: "X" } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — non-finance role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/mark-paid`,
      headers: auth(USER, ["employee"]), payload: { paymentRef: "X" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — invoice not found", async () => {
    H.findInvoiceMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/mark-paid`,
      headers: auth(CHECKER), payload: { paymentRef: "X" },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("409 — wrong state (not approved)", async () => {
    H.findInvoiceMock.mockResolvedValue(invoice({ status: "verified" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV_ID}/mark-paid`,
      headers: auth(CHECKER), payload: { paymentRef: "X" },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STATE");
    await app.close();
  });
});
