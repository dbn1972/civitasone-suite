/**
 * procurement-service: cross-module HTTP call is behind the shared module-licence check (module-sale gap M5).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchSanctionBalance } from "../src/modules/po/finance-budget-client.js";

const ENF_NO = "e1111111-1111-4111-8111-111111111111"; // enforce, module NOT bought
const ENF_YES = "e2222222-2222-4222-8222-222222222222"; // enforce, module bought
const OFF = "0f333333-3333-4333-8333-333333333333"; //     off (the default), module not bought
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
const SANCTION = "9c1a0000-0000-4000-8000-000000000001";
const ok = () => ({ ok: true, status: 200, json: async () => ({ available: "500" }) });

describe("procurement -> finance sanction balance", () => {
  it("check switched off: finance is called as before", async () => {
    vi.stubEnv("MODULE_LICENCE_CHECK", "");
    const calls = stubFetch({}, ok);
    expect(await fetchSanctionBalance(ENF_NO, SANCTION)).toEqual({ kind: "ok", available: 500n });
    expect(calls).toHaveLength(1);
  });
  it("tenant off: finance is called", async () => {
    const calls = stubFetch({ [OFF]: proj("off", []) }, ok);
    expect((await fetchSanctionBalance(OFF, SANCTION)).kind).toBe("ok");
    expect(calls).toHaveLength(1);
  });
  it("watch-only: finance is still called", async () => {
    const calls = stubFetch({ [SHADOW]: proj("shadow", []) }, ok);
    expect((await fetchSanctionBalance(SHADOW, SANCTION)).kind).toBe("ok");
    expect(calls).toHaveLength(1);
  });
  it("enforce + finance not bought: finance is NOT called", async () => {
    const calls = stubFetch({ [ENF_NO]: proj("enforce", ["procurement"]) }, ok);
    const r = await fetchSanctionBalance(ENF_NO, SANCTION);
    expect(r).toMatchObject({ kind: "unavailable" });
    expect((r as { reason: string }).reason).toContain("not licensed");
    expect(calls).toHaveLength(0);
  });
  it("enforce + finance bought: finance is called; another tenant is unaffected", async () => {
    const calls = stubFetch({ [ENF_YES]: proj("enforce", ["finance"]), [ENF_NO]: proj("enforce", []) }, ok);
    expect((await fetchSanctionBalance(ENF_YES, SANCTION)).kind).toBe("ok");
    expect((await fetchSanctionBalance(ENF_NO, SANCTION)).kind).toBe("unavailable");
    expect(calls).toHaveLength(1);
  });
});
