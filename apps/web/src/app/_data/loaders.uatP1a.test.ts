import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));

import {
  getSrnByGrn,
  getCagParas,
  getFinanceVendors,
  getFinanceAllocations,
  getAdminRoleById,
  getAdminUserById,
  getProcurementVendorById,
  getProcurementPOs,
} from "./loaders";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    clone() {
      return jsonResponse(status, body);
    },
  } as unknown as Response;
}

const stub = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(status, body)));

// Response shapes as captured from UAT (GET via the gateway, 3 Nov), trimmed.
describe("UAT phase 1A loaders", () => {
  beforeEach(() => {
    mockGet.mockReturnValue({ value: "fake-access-token" });
    process.env.CIVITASONE_API_BASE_URL = "http://gateway.test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CIVITASONE_API_BASE_URL;
  });

  it("finance vendors: a {data, meta} response loads (recon D03)", async () => {
    stub(200, {
      data: [{ id: "v1", name: "Vendor-QHY8EL", category: "goods", pan: "AAAAA0000A", gstin: null, status: "active", ratingDisplay: "—" }],
      meta: { page: 1, pageSize: 50, total: 1 },
    });
    const r = await getFinanceVendors();
    expect(r.source).toBe("api");
    expect(r.data.map((v) => v.name)).toEqual(["Vendor-QHY8EL"]);
  });

  it("budget allocations: a {data} response loads (recon D04)", async () => {
    stub(200, { data: [] });
    const r = await getFinanceAllocations();
    expect(r).toEqual({ data: [], source: "api" });
  });

  it("CAG paras: an audit-service {items, total, limit, offset} response loads", async () => {
    stub(200, { items: [{ id: "p1", paraNo: "1.1", status: "open" }], total: 1, limit: 50, offset: 0 });
    const r = await getCagParas();
    expect(r.source).toBe("api");
    expect(r.data).toHaveLength(1);
  });

  it("role detail without createdAt loads", async () => {
    stub(200, { id: "055940b4-cd49-48e5-86bc-34108364d692", tenantId: "t", name: "auditor", description: "Auditor", status: "active", version: 1 });
    const r = await getAdminRoleById("055940b4-cd49-48e5-86bc-34108364d692");
    expect(r.source).toBe("api");
    expect(r.data?.name).toBe("auditor");
  });

  it("user detail without createdAt loads", async () => {
    stub(200, { id: "u1", tenantId: "t", email: "a@b.in", name: "A", empCode: "E1", status: "active", mfaEnabled: false, version: 1 });
    const r = await getAdminUserById("u1");
    expect(r.source).toBe("api");
    expect(r.data?.email).toBe("a@b.in");
  });

  it("procurement vendor detail: a {data: {...}} response loads", async () => {
    stub(200, { data: { id: "0ad64299-21f3-4232-b915-5d863fbb1f6c", name: "Vendor A", vendorType: "registered", category: "goods", email: "v@x.in", kycStatus: "pending" } });
    const r = await getProcurementVendorById("0ad64299-21f3-4232-b915-5d863fbb1f6c");
    expect(r.source).toBe("api");
    expect(r.data?.id).toBe("0ad64299-21f3-4232-b915-5d863fbb1f6c");
    expect(r.data?.email).toBe("v@x.in");
  });

  it("SRN: 200 {data: null} is 'no SRN yet', not a load failure", async () => {
    stub(200, { data: null });
    const r = await getSrnByGrn("022fbc4e-ea5e-40f9-89dc-919567b92ff1");
    expect(r).toEqual({ data: null, source: "api" });
  });

  it("SRN: a malformed body is still an error", async () => {
    stub(200, { unexpected: true });
    const r = await getSrnByGrn("g1");
    expect(r.source).toBe("error");
    expect(r.data).toBeNull();
  });

  it("SRN: a 500 is still an error with its status", async () => {
    stub(500, { code: "INTERNAL", message: "internal error" });
    const r = await getSrnByGrn("g1");
    expect(r.source).toBe("error");
    expect(r.status).toBe(500);
    expect(r.data).toBeNull();
  });

  it("PO list: a closed PO shows as Closed", async () => {
    stub(200, { data: [{ id: "po1", poNo: "PO/2026/0031", vendor: "V", amountDisplay: "₹1", totalMinor: "100", orderDate: "2026-08-12", status: "closed" }] });
    const r = await getProcurementPOs();
    expect(r.source).toBe("api");
    expect(r.data[0]?.status).toBe("closed");
  });
});
