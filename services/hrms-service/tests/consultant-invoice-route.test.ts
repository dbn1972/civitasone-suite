/**
 * Consultant invoice route wiring — lifecycle (submit→verify→approve→paid),
 * two-person control, engagement boundary guard, and the 194J TDS + GST
 * computation at approval with the Finance-AP outbox event.
 *
 * repo / db / outbox / resolver boundaries are mocked; the real route logic,
 * status machine and computeInvoiceTax run.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000c1";
const MAKER = "aaaaaaaa-7777-4000-8000-00000000ma01";
const CHECKER = "aaaaaaaa-7777-4000-8000-00000000ch01";
const CONSULTANT = "66666666-6666-4000-8000-000000000006";
const INV = "77777777-7777-4000-8000-000000000007";

const H = vi.hoisted(() => ({
  scopedReadMock: vi.fn(),
  findInvoiceMock: vi.fn(),
  insertInvoiceMock: vi.fn(),
  updateInvoiceMock: vi.fn(),
  ytdMock: vi.fn(),
  enqueueMock: vi.fn(),
  loadResolverMock: vi.fn(),
  empType: { type: "consultant" },
}));

vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  scopedRead: (...a: unknown[]) => H.scopedReadMock(...a),
  db: { transaction: async (cb: (tx: unknown) => Promise<void>) => cb({}), insert: () => ({ values: async () => undefined }) },
}));
vi.mock("../src/modules/consultant-invoice/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  insertInvoice: (...a: unknown[]) => H.insertInvoiceMock(...a),
  findInvoice: (...a: unknown[]) => H.findInvoiceMock(...a),
  updateInvoice: (...a: unknown[]) => H.updateInvoiceMock(...a),
  ytdApprovedGross: (...a: unknown[]) => H.ytdMock(...a),
  ytdApprovedGrossTx: (...a: unknown[]) => H.ytdMock(...a.slice(1)),
  lockConsultantForInvoicing: async () => undefined,
  listByConsultant: async () => [],
  listByStatus: async () => [],
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
  { category: "pay_scale",  eligibleForPayroll: true },
];
const tok = (sub: string) => signToken({ sub, tid: TENANT, roles: ["hr_admin", "finance_officer"], sid: "s" }, SECRET);
const auth = (sub: string) => ({ authorization: `Bearer ${tok(sub)}` });

function invoice(over: Record<string, unknown> = {}) {
  return {
    id: INV, tenantId: TENANT, consultantId: CONSULTANT, invoiceNo: "INV-1",
    invoiceDate: "2026-05-10", grossMinor: 5_000_000n, gstApplicable: true, gstRateBps: 1800,
    tdsSection: "194J", tdsRateBps: 1000, gstMinor: 0n, tdsMinor: 0n, netPayableMinor: 0n,
    gstin: null, sacCode: null, status: "submitted", verifiedBy: null, version: 1, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.scopedReadMock.mockImplementation(async () => [
    { id: CONSULTANT, tenantId: TENANT, employeeType: H.empType.type, gstin: null, sacCode: null },
  ]);
  H.loadResolverMock.mockResolvedValue(buildTypeResolver([], CANON));
  H.ytdMock.mockResolvedValue(0n);
  H.updateInvoiceMock.mockResolvedValue(undefined);
  H.enqueueMock.mockResolvedValue(undefined);
  H.insertInvoiceMock.mockResolvedValue(undefined);
});

afterAll(async () => { await sqlClient.end(); });

describe("consultant invoice routes", () => {
  it("submits an invoice for a consultant (201)", async () => {
    H.empType.type = "consultant";
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultants/${CONSULTANT}/invoices`,
      headers: auth(MAKER),
      payload: { invoiceNo: "INV-1", invoiceDate: "2026-05-10", grossMinor: 5000000, gstApplicable: true, gstRateBps: 1800 },
    });
    expect(r.statusCode).toBe(201);
    expect(H.insertInvoiceMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rejects an invoice for a payroll-eligible (salaried) employee (409)", async () => {
    H.empType.type = "pay_scale";
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultants/${CONSULTANT}/invoices`,
      headers: auth(MAKER),
      payload: { invoiceNo: "INV-2", invoiceDate: "2026-05-10", grossMinor: 5000000 },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NOT_A_CONSULTANT");
    expect(H.insertInvoiceMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("computes 194J TDS + 18% GST at approval and emits the AP event", async () => {
    H.findInvoiceMock.mockResolvedValue(invoice({ status: "verified", verifiedBy: MAKER }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV}/approve`, headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.gstMinor).toBe("900000");
    expect(body.tdsMinor).toBe("500000");
    expect(body.netPayableMinor).toBe("5400000");
    expect(body.tdsApplied).toBe(true);
    // persisted the computed amounts
    const patch = H.updateInvoiceMock.mock.calls[0][3];
    expect(patch.status).toBe("approved");
    expect(patch.netPayableMinor).toBe(5_400_000n);
    // Finance-AP outbox event
    const ev = H.enqueueMock.mock.calls[0][1];
    expect(ev.topic).toBe("hrms.consultant_invoice.approved");
    expect(ev.payload.tdsMinor).toBe("500000");
    await app.close();
  });

  it("checker can override a submitter-suppressed TDS rate at approval", async () => {
    // Submitter set tdsRateBps: 0 to dodge 194J; the finance checker re-asserts 10%.
    H.findInvoiceMock.mockResolvedValue(invoice({ status: "verified", verifiedBy: MAKER, tdsRateBps: 0, gstApplicable: false }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV}/approve`, headers: auth(CHECKER),
      payload: { tdsRateBps: 1000 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().tdsMinor).toBe("500000"); // 10% enforced by checker despite tdsRateBps:0 on submit
    const patch = H.updateInvoiceMock.mock.calls[0][3];
    expect(patch.tdsRateBps).toBe(1000);       // authoritative rate persisted
    await app.close();
  });

  it("enforces two-person control — approver cannot be the verifier (409)", async () => {
    H.findInvoiceMock.mockResolvedValue(invoice({ status: "verified", verifiedBy: CHECKER }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV}/approve`, headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("SOD_VIOLATION");
    expect(H.updateInvoiceMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects approve when not in verified state (409 WRONG_STATE)", async () => {
    H.findInvoiceMock.mockResolvedValue(invoice({ status: "submitted" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV}/approve`, headers: auth(CHECKER), payload: {},
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("WRONG_STATE");
    await app.close();
  });

  it("marks an approved invoice paid and emits the paid event", async () => {
    H.findInvoiceMock.mockResolvedValue(invoice({ status: "approved", netPayableMinor: 5_400_000n }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${INV}/mark-paid`, headers: auth(CHECKER),
      payload: { paymentRef: "UTR-123" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("paid");
    expect(H.enqueueMock.mock.calls[0][1].topic).toBe("hrms.consultant_invoice.paid");
    await app.close();
  });
});
