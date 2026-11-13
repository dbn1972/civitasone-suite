/**
 * finance-service: cross-module HTTP call is behind the shared module-licence check (module-sale gap M5).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchProcurementVendorNames } from "../src/shared/procurement-client.js";

const ENF_NO = "e1111111-1111-4111-8111-111111111111"; // enforce, module NOT bought
const ENF_YES = "e2222222-2222-4222-8222-222222222222"; // enforce, module bought
const SHADOW = "5a444444-4444-4444-8444-444444444444"; //  watch-only, module not bought

type Proj = { configured: boolean; mode: string; data: Array<{ name: string }> };

/** Stub fetch: admin composition projection per tenant, everything else goes to `target` and is recorded. */
function stubFetch(projections: Record<string, Proj>, target: (url: string) => unknown = () => ({ ok: true, status: 200, json: async () => ({}) })) {
  const targetCalls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/composition/internal/")) {
        const tid = /([0-9a-f]{8}-[0-9a-f-]{27})/i.exec(String(url))?.[1] ?? "";
        const p = projections[tid];
        if (!p) return { ok: false, status: 404, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => p };
      }
      targetCalls.push(String(url));
      return target(String(url));
    }),
  );
  return targetCalls;
}
const proj = (mode: string, modules: string[]): Proj => ({ configured: true, mode, data: modules.map((name) => ({ name })) });

beforeEach(() => {
  vi.stubEnv("MODULE_LICENCE_CHECK", "on");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const ids = ["v1"];
const ok = () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: "v1", name: "Acme Traders" }] }) });

describe("finance -> procurement vendor names (display enrichment)", () => {
  it("check switched off: procurement is called", async () => {
    vi.stubEnv("MODULE_LICENCE_CHECK", "");
    const calls = stubFetch({}, ok);
    expect((await fetchProcurementVendorNames(ENF_NO, ids)).get("v1")).toBe("Acme Traders");
    expect(calls).toHaveLength(1);
  });
  it("watch-only: still called", async () => {
    const calls = stubFetch({ [SHADOW]: proj("shadow", []) }, ok);
    expect((await fetchProcurementVendorNames(SHADOW, ids)).size).toBe(1);
    expect(calls).toHaveLength(1);
  });
  it("enforce + procurement not bought: not called, empty map (the existing 'unknown vendor' answer)", async () => {
    const calls = stubFetch({ [ENF_NO]: proj("enforce", ["finance"]) }, ok);
    expect((await fetchProcurementVendorNames(ENF_NO, ids)).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
  it("enforce + procurement bought: called", async () => {
    const calls = stubFetch({ [ENF_YES]: proj("enforce", ["procurement"]) }, ok);
    expect((await fetchProcurementVendorNames(ENF_YES, ids)).size).toBe(1);
    expect(calls).toHaveLength(1);
  });
});
