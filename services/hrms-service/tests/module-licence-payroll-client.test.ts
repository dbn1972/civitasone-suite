/**
 * hrms-service: cross-module HTTP call is behind the shared module-licence check (module-sale gap M5).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchPayrollLockedThrough, PayrollUnavailableError } from "../src/shared/payroll-client.js";

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
const locked = () => ({ ok: true, status: 200, json: async () => ({ lockedThrough: "2026-03" }) });

describe("hrms -> payroll locked-through (pay-profile guard)", () => {
  it("check switched off: payroll is called", async () => {
    vi.stubEnv("MODULE_LICENCE_CHECK", "");
    const calls = stubFetch({}, locked);
    expect(await fetchPayrollLockedThrough(ENF_NO)).toBe("2026-03");
    expect(calls).toHaveLength(1);
  });
  it("watch-only: payroll is still called", async () => {
    const calls = stubFetch({ [SHADOW]: proj("shadow", []) }, locked);
    expect(await fetchPayrollLockedThrough(SHADOW)).toBe("2026-03");
    expect(calls).toHaveLength(1);
  });
  it("enforce + payroll not bought: payroll is NOT called; callers still fail closed (PayrollUnavailableError)", async () => {
    const calls = stubFetch({ [ENF_NO]: proj("enforce", ["workforce_core"]) }, locked);
    const err = await fetchPayrollLockedThrough(ENF_NO).catch((e) => e);
    expect(err).toBeInstanceOf(PayrollUnavailableError);
    expect(String(err.message)).toContain("not licensed");
    expect(calls).toHaveLength(0);
  });
  it("enforce + payroll bought: payroll is called", async () => {
    const calls = stubFetch({ [ENF_YES]: proj("enforce", ["payroll"]) }, locked);
    expect(await fetchPayrollLockedThrough(ENF_YES)).toBe("2026-03");
    expect(calls).toHaveLength(1);
  });
});
