/**
 * UAT Phase 2 C7 — finance bills (expenditure):
 *  - D14: every bill raised from a procurement GRN read "Unknown vendor": the
 *    bill cites the procurement vendor id, which finance's vendor master does not
 *    hold. Names now fall back to procurement-service's internal id -> name lookup.
 *  - D15: the list hard-coded threeWayMatch "na" while the detail said "matched"
 *    whenever both refs were present. Both now report the pass gate's verdict.
 * Repos are mocked and fetch is stubbed; no Postgres, no live service.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { signToken } from "@civitasone/auth";

const listBillsByTenant = vi.fn();
const findBillByIdAndTenant = vi.fn();
const getVendorNamesByIds = vi.fn();

vi.mock("../src/modules/payments/repo.js", () => ({
  listBillsByTenant: (...a: unknown[]) => listBillsByTenant(...a),
  findBillByIdAndTenant: (...a: unknown[]) => findBillByIdAndTenant(...a),
}));
vi.mock("../src/modules/masters/repo.js", () => ({
  getVendorNamesByIds: (...a: unknown[]) => getVendorNamesByIds(...a),
  getVendorById: vi.fn().mockResolvedValue(null),
}));

import { paymentsRoutes } from "../src/modules/payments/routes.js";
import { financeErrorHandler } from "../src/shared/context.js";
import { billThreeWayMatchStatus } from "../src/modules/payments/domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-3333-4000-8000-0000000000c7";
const ACTOR = "00000000-aaaa-4000-8000-0000000000c7";
const FIN_VENDOR = "66666666-aaaa-4000-8000-0000000000c7";
const PROC_VENDOR = "77777777-aaaa-4000-8000-0000000000c7";

const hdr = () => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["finance_officer"], sid: "s" }, SECRET)}` });
async function app() {
  const a = Fastify();
  a.setErrorHandler(financeErrorHandler);
  await a.register(paymentsRoutes);
  await a.ready();
  return a;
}
const bill = (id: string, over: Record<string, unknown> = {}) => ({
  id, tenantId: TENANT, billNo: `BILL/GRN/${id.slice(-4)}`, vendorId: PROC_VENDOR, netMinor: 50000n, grossMinor: 50000n,
  createdAt: "2026-08-12T00:00:00.000Z", status: "pending", poRef: null, grnRef: null, poAmountMinor: null, grnAmountMinor: null, ...over,
});

type Asked = { url: string; headers: Headers };
function stubProcurement(answer: "names" | "down"): Asked[] {
  const asked: Asked[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    asked.push({ url, headers: new Headers(init?.headers) });
    if (answer === "down") throw new TypeError("fetch failed");
    if (url.includes("/v1/procurement/internal/vendor-names")) {
      return new Response(JSON.stringify({ data: [{ id: PROC_VENDOR, name: "UATTEST-g4-5-A" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  });
  return asked;
}

beforeEach(() => {
  [listBillsByTenant, findBillByIdAndTenant, getVendorNamesByIds].forEach((m) => m.mockReset());
  getVendorNamesByIds.mockImplementation(async (_t: string, ids: string[]) => new Map(ids.filter((i) => i === FIN_VENDOR).map((i) => [i, "Finance Master Vendor"])));
});
afterEach(() => { vi.restoreAllMocks(); });

describe("C7 billThreeWayMatchStatus (pure)", () => {
  const base = { poRef: "procurement_po:p", grnRef: "procurement_grn:g", grossMinor: 50000n };
  it("na without refs; pending with one ref or without amount snapshots", () => {
    expect(billThreeWayMatchStatus({ ...base, poRef: null, grnRef: null, poAmountMinor: null, grnAmountMinor: null })).toBe("na");
    expect(billThreeWayMatchStatus({ ...base, grnRef: null, poAmountMinor: 50000n, grnAmountMinor: 50000n })).toBe("pending");
    expect(billThreeWayMatchStatus({ ...base, poAmountMinor: null, grnAmountMinor: null })).toBe("pending");
  });
  it("matched only when PO, GRN and invoice reconcile; unmatched otherwise", () => {
    expect(billThreeWayMatchStatus({ ...base, poAmountMinor: 50000n, grnAmountMinor: 50000n }, 2)).toBe("matched");
    expect(billThreeWayMatchStatus({ ...base, poAmountMinor: "50000", grnAmountMinor: "20000" }, 2)).toBe("unmatched");
    expect(billThreeWayMatchStatus({ ...base, poAmountMinor: 0n, grnAmountMinor: 0n }, 2)).toBe("unmatched");
  });
});

describe("C7 GET /v1/finance/bills", () => {
  it("names a procurement vendor via procurement-service (was 'Unknown vendor') and keeps finance-master names", async () => {
    const asked = stubProcurement("names");
    listBillsByTenant.mockResolvedValue([
      bill("00000000-0000-4000-8000-00000000c701"),
      bill("00000000-0000-4000-8000-00000000c702", { vendorId: FIN_VENDOR }),
    ]);
    const res = await (await app()).inject({ method: "GET", url: "/v1/finance/bills?limit=11", headers: hdr() });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((b: { vendor: string }) => b.vendor)).toEqual(["UATTEST-g4-5-A", "Finance Master Vendor"]);
    const call = asked.find((a) => a.url.includes("/internal/vendor-names"))!;
    expect(call.url).toContain(`ids=${PROC_VENDOR}`);
    expect(call.url).not.toContain(FIN_VENDOR);
    expect(call.headers.get("x-internal")).toBe("1");
    expect(call.headers.get("x-tenant-id")).toBe(TENANT);
  });

  it("keeps 'Unknown vendor' when procurement-service is unreachable (fail-open, still 200)", async () => {
    stubProcurement("down");
    listBillsByTenant.mockResolvedValue([bill("00000000-0000-4000-8000-00000000c703")]);
    const res = await (await app()).inject({ method: "GET", url: "/v1/finance/bills?limit=12", headers: hdr() });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].vendor).toBe("Unknown vendor");
  });

  it("reports the real 3-way-match state per row instead of a hard-coded 'na'", async () => {
    stubProcurement("names");
    listBillsByTenant.mockResolvedValue([
      bill("00000000-0000-4000-8000-00000000c704", { poRef: "procurement_po:p", grnRef: "procurement_grn:g", poAmountMinor: 50000n, grnAmountMinor: 50000n }),
      bill("00000000-0000-4000-8000-00000000c705", { poRef: "procurement_po:p", grnRef: "procurement_grn:g" }),
      bill("00000000-0000-4000-8000-00000000c706"),
    ]);
    const res = await (await app()).inject({ method: "GET", url: "/v1/finance/bills?limit=13", headers: hdr() });
    expect(res.json().map((b: { threeWayMatch: string }) => b.threeWayMatch)).toEqual(["matched", "pending", "na"]);
  });
});

describe("C7 GET /v1/finance/bills/:id", () => {
  it("does not claim 'matched' for a bill with PO+GRN refs but no amounts (was 'matched'); names the vendor", async () => {
    stubProcurement("names");
    const id = "00000000-0000-4000-8000-00000000c707";
    findBillByIdAndTenant.mockResolvedValue(bill(id, { poRef: "procurement_po:c78d6089", grnRef: "procurement_grn:710a245e" }));
    const res = await (await app()).inject({ method: "GET", url: `/v1/finance/bills/${id}`, headers: hdr() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ vendor: "UATTEST-g4-5-A", threeWayMatch: "pending" });
  });
});
