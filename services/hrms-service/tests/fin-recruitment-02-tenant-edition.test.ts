/**
 * GAP-RECRUITMENT-NEW-06 follow-up: the requisition-first default comes from the real tenant edition
 * (tenant.tenants.edition via tenant-service), mapped by editionFromTenant; unknown => fail closed (OFF).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { editionFromTenant, requisitionRequired } from "../src/modules/recruitment/edition-policy.js";
import { fetchTenantEdition, resetTenantEditionCache } from "../src/shared/tenant-client.js";

describe("editionFromTenant", () => {
  it("govt and govt_dept (any case/whitespace) map to govt => requisition-first ON", () => {
    for (const v of ["govt", "govt_dept", " GOVT ", "Govt_Dept"]) {
      expect(editionFromTenant(v)).toBe("govt");
      expect(requisitionRequired({ edition: editionFromTenant(v)!, requireRequisition: null })).toBe(true);
    }
  });
  it("every other known edition maps to a non-govt edition => OFF", () => {
    expect(editionFromTenant("psu")).toBe("psu");
    for (const v of ["private", "ngo", "section8", "cooperative", "small_office"]) {
      expect(editionFromTenant(v)).toBe("small_office");
      expect(requisitionRequired({ edition: editionFromTenant(v)!, requireRequisition: null })).toBe(false);
    }
  });
  it("unknown, empty or missing editions map to null (caller fails closed and warns)", () => {
    for (const v of ["", "   ", "government", "govt2", undefined, null]) expect(editionFromTenant(v as string | undefined)).toBeNull();
  });
  it("an explicit override still beats the edition", () => {
    expect(requisitionRequired({ edition: "govt", requireRequisition: false })).toBe(false);
    expect(requisitionRequired({ edition: "small_office", requireRequisition: true })).toBe(true);
  });
});

describe("fetchTenantEdition", () => {
  beforeEach(() => resetTenantEditionCache());
  afterEach(() => vi.unstubAllGlobals());

  it("reads the edition from tenant-service over the internal boundary and caches it", async () => {
    const fn = vi.fn(async () => new Response(JSON.stringify({ edition: "Govt_Dept" }), { status: 200 }));
    vi.stubGlobal("fetch", fn);
    expect(await fetchTenantEdition("t-1")).toBe("govt_dept");
    expect(await fetchTenantEdition("t-1")).toBe("govt_dept");
    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v1\/tenants\/t-1$/);
    expect((init.headers as Record<string, string>)["x-internal"]).toBe("1");
    expect((init.headers as Record<string, string>)["x-tenant-id"]).toBe("t-1");
  });

  it("fails closed (undefined) on a network error, a non-2xx or a malformed body, and never caches a failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    expect(await fetchTenantEdition("t-2")).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    expect(await fetchTenantEdition("t-2")).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ edition: 5 }), { status: 200 })));
    expect(await fetchTenantEdition("t-2")).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ edition: "govt" }), { status: 200 })));
    expect(await fetchTenantEdition("t-2")).toBe("govt");
  });
});
