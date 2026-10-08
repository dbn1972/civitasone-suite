/**
 * HIGH (review of PR #1786): GET /v1/finance/bills[/:id] must serve bills the
 * service itself emits as `passed` / `on_hold` (and detail threeWayMatch
 * "pending") through the REAL route + sendValidated. Before the schema was
 * aligned with mapBillStatus the route threw on the first such row.
 * Also: POST /v1/finance/bills refuses a deactivated vendor (409).
 * repo / masters repo / commands are mocked; no Postgres needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { signToken } from "@civitasone/auth";

const listBillsByTenant = vi.fn();
const findBillByIdAndTenant = vi.fn();
const getVendorById = vi.fn();
const getVendorNamesByIds = vi.fn();
const createBill = vi.fn();

vi.mock("../src/modules/payments/repo.js", () => ({
  listBillsByTenant: (...a: unknown[]) => listBillsByTenant(...a),
  findBillByIdAndTenant: (...a: unknown[]) => findBillByIdAndTenant(...a),
}));
vi.mock("../src/modules/masters/repo.js", () => ({
  getVendorById: (...a: unknown[]) => getVendorById(...a),
  // GAP2-FINANCE-BILLS-VENDORNAME-01: listBillSummaries now resolves vendor
  // names from the masters repo (batched); provide the stub so these route
  // tests stay DB-free. Returns the names set by each test (default empty).
  getVendorNamesByIds: (...a: unknown[]) => getVendorNamesByIds(...a),
}));
vi.mock("../src/modules/payments/commands.js", () => ({ createBill: (...a: unknown[]) => createBill(...a) }));

import { paymentsRoutes } from "../src/modules/payments/routes.js";
import { financeErrorHandler } from "../src/shared/context.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-3333-4000-8000-0000000000b1";
const ACTOR = "00000000-aaaa-4000-8000-0000000000b1";
const VENDOR = "66666666-aaaa-4000-8000-0000000000b1";
const HEAD = "66666666-bbbb-4000-8000-0000000000b1";

const hdr = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}` });
async function app() {
  const a = Fastify();
  a.setErrorHandler(financeErrorHandler);
  await a.register(paymentsRoutes);
  await a.ready();
  return a;
}
const row = (id: string, status: string, over: Record<string, unknown> = {}) => ({
  id, tenantId: TENANT, billNo: `B-${status}`, vendorId: VENDOR, netMinor: 150000n, createdAt: "2026-09-01T00:00:00.000Z",
  status, poRef: null, grnRef: null, ...over,
});

describe("bills routes with passed / on_hold rows", () => {
  beforeEach(() => { [listBillsByTenant, findBillByIdAndTenant, getVendorById, getVendorNamesByIds, createBill].forEach((m) => m.mockReset()); getVendorNamesByIds.mockResolvedValue(new Map()); getVendorById.mockResolvedValue(null); });

  it("GET /v1/finance/bills serves passed, on_hold, draft and approved rows (200, statuses as emitted)", async () => {
    listBillsByTenant.mockResolvedValue([
      row("00000000-0000-4000-8000-000000000001", "passed"),
      row("00000000-0000-4000-8000-000000000002", "on_hold"),
      row("00000000-0000-4000-8000-000000000003", "draft"),
      row("00000000-0000-4000-8000-000000000004", "approved"),
    ]);
    // GAP2-FINANCE-BILLS-VENDORNAME-01: a non-fixture vendor id resolves to its
    // real master-data name; an unresolved one shows "Unknown vendor".
    getVendorNamesByIds.mockResolvedValue(new Map([[VENDOR, "M/s Real Tenant Vendor Ltd."]]));
    const res = await (await app()).inject({ method: "GET", url: "/v1/finance/bills", headers: hdr(["finance_officer"]) });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const statuses = body.map((b: { status: string }) => b.status);
    expect(statuses).toEqual(["passed", "on_hold", "pending", "passed"]);
    expect(body[0].vendor).toBe("M/s Real Tenant Vendor Ltd.");
    expect(body[0].vendor).not.toMatch(/^Vendor \(/);
  });

  it("GET /v1/finance/bills/:id serves a passed bill with threeWayMatch 'pending' (PO without GRN)", async () => {
    findBillByIdAndTenant.mockResolvedValue(row("00000000-0000-4000-8000-000000000001", "passed", { poRef: "PO-1" }));
    const res = await (await app()).inject({ method: "GET", url: "/v1/finance/bills/00000000-0000-4000-8000-000000000001", headers: hdr(["finance_officer"]) });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ status: "passed", threeWayMatch: "pending" });
  });
});

describe("POST /v1/finance/bills vendor check", () => {
  const body = { billNo: "INV-1", vendorId: VENDOR, headId: HEAD, ddoCode: "DDO12345", grossMinor: "100000" };
  beforeEach(() => { getVendorById.mockReset(); createBill.mockReset().mockResolvedValue({ id: "x", status: "accepted", correlationId: "c" }); });

  it("409 VENDOR_INACTIVE for a deactivated vendor, and nothing is queued", async () => {
    getVendorById.mockResolvedValue({ id: VENDOR, isActive: false });
    const res = await (await app()).inject({ method: "POST", url: "/v1/finance/bills", headers: hdr(["finance_officer"]), payload: body });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe("VENDOR_INACTIVE");
    expect(createBill).not.toHaveBeenCalled();
  });

  it("accepts an active vendor", async () => {
    getVendorById.mockResolvedValue({ id: VENDOR, isActive: true });
    const res = await (await app()).inject({ method: "POST", url: "/v1/finance/bills", headers: hdr(["finance_officer"]), payload: body });
    expect(res.statusCode).toBe(202);
    expect(createBill).toHaveBeenCalledTimes(1);
  });

  it("an unknown vendor row is tolerated (bills.vendor_id has no FK yet)", async () => {
    getVendorById.mockResolvedValue(null);
    const res = await (await app()).inject({ method: "POST", url: "/v1/finance/bills", headers: hdr(["finance_officer"]), payload: body });
    expect(res.statusCode).toBe(202);
  });
});
