/**
 * asset-service: cross-module HTTP call is behind the shared module-licence check (module-sale gap M5).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateHead } from "../src/shared/finance-client.js";

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
const fail500 = () => ({ ok: false, status: 500, json: async () => ({}) });

describe("asset -> finance account head validation", () => {
  beforeEach(() => vi.stubEnv("INTERNAL_SERVICE_SECRET", `s-${Date.now()}`));

  it("check switched off: finance is called (and its answer used)", async () => {
    vi.stubEnv("MODULE_LICENCE_CHECK", "");
    const calls = stubFetch({}, fail500);
    const r = await validateHead(ENF_NO, "cwip", "1201");
    expect(r).toMatchObject({ ok: false, reason: "UNAVAILABLE" });
    expect((r as { detail: string }).detail).toContain("finance answered 500");
    expect(calls).toHaveLength(1);
  });
  it("watch-only: finance is still called", async () => {
    const calls = stubFetch({ [SHADOW]: proj("shadow", []) }, fail500);
    await validateHead(SHADOW, "cwip", "1201");
    expect(calls).toHaveLength(1);
  });
  it("enforce + finance not bought: finance is NOT called; fails as UNAVAILABLE with a licence reason", async () => {
    const calls = stubFetch({ [ENF_NO]: proj("enforce", ["assets"]) }, fail500);
    const r = await validateHead(ENF_NO, "cwip", "1201");
    expect(r).toMatchObject({ ok: false, reason: "UNAVAILABLE" });
    expect((r as { detail: string }).detail).toContain("not licensed");
    expect(calls).toHaveLength(0);
  });
  it("enforce + finance bought: finance is called", async () => {
    const calls = stubFetch({ [ENF_YES]: proj("enforce", ["finance"]) }, fail500);
    await validateHead(ENF_YES, "cwip", "1201");
    expect(calls).toHaveLength(1);
  });
});
