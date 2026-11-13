/**
 * location-service: location -> hrms employee count (a tenant without the HR module has no employees to orphan, so the count is 0) behind the shared module-licence check (module-sale gap M5).
 * Per call: switched off / watch-only still make the call; enforce + module not bought does NOT make it and returns
 * the call's existing failure shape; enforce + module bought makes it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { countActiveEmployeesAt } from "../src/shared/hrms-client.js";

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
  vi.stubEnv("INTERNAL_SERVICE_SECRET", `s-${Date.now()}`);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Case = { name: string; call: (t: string) => Promise<unknown>; denied: (r: unknown, thrown: unknown) => void };
const ok500 = () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "" });
const cases: Case[] = [
  { name: "countActiveEmployeesAt", call: (t) => countActiveEmployeesAt(t, 'loc1'), denied: (r, thrown) => { expect(thrown).toBeUndefined(); expect(r).toEqual({ ok: true, total: 0 }); } },
];

for (const c of cases) {
  describe(c.name, () => {
    const run = async (t: string) => {
      let r: unknown, thrown: unknown;
      try { r = await c.call(t); } catch (e) { thrown = e; }
      return { r, thrown };
    };
    it("check switched off: the call is made", async () => {
      vi.stubEnv("MODULE_LICENCE_CHECK", "");
      const calls = stubFetch({}, ok500);
      await run(ENF_NO);
      expect(calls.length).toBeGreaterThan(0);
    });
    it("tenant off (default): the call is made", async () => {
      const calls = stubFetch({ [OFF]: proj("off", []) }, ok500);
      await run(OFF);
      expect(calls.length).toBeGreaterThan(0);
    });
    it("watch-only: the call is still made", async () => {
      const calls = stubFetch({ [SHADOW]: proj("shadow", []) }, ok500);
      await run(SHADOW);
      expect(calls.length).toBeGreaterThan(0);
    });
    it("enforce + module not bought: NOT made, existing failure shape", async () => {
      const calls = stubFetch({ [ENF_NO]: proj("enforce", ["unrelated"]) }, ok500);
      const { r, thrown } = await run(ENF_NO);
      expect(calls).toHaveLength(0);
      c.denied(r, thrown);
    });
    it("enforce + module bought: made", async () => {
      const calls = stubFetch({ [ENF_YES]: proj("enforce", ["workforce_core"]) }, ok500);
      await run(ENF_YES);
      expect(calls.length).toBeGreaterThan(0);
    });
  });
}
