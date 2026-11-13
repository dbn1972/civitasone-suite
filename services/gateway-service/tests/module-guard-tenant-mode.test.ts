/**
 * Gateway module-guard - per-tenant module mode (module-sale gap M3).
 *
 * GATEWAY_TENANT_MODULE_MODE=on lets each tenant choose between the legacy coarse module list and the per-module
 * composition list, driven by the tenant's composition enforcement mode: off (legacy, today) | shadow (watch-only:
 * legacy decides, the per-module decision is logged + counted, never blocks) | enforce (per-module, fail closed).
 * With the env unset nothing changes and the composition projection is never fetched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkModuleEnabled, invalidateModuleCache, _test } from "../src/module-guard.js";
import { moduleGuardWouldDenyTotal } from "../src/response-metrics.js";

const A = "aaaaaaaa-2222-4000-8000-000000000001";
const B = "bbbbbbbb-2222-4000-8000-000000000002";

function fakeReq(tid?: string, warns: unknown[] = []): any {
  return { headers: tid ? { "x-tenant-id": tid } : {}, id: "req-test", log: { warn: (o: unknown) => warns.push(o) } };
}
function fakeReply(): any {
  const r: any = { _code: 200, _body: null };
  r.code = (n: number) => ((r._code = n), r);
  r.header = () => r;
  r.send = (b: any) => ((r._body = b), r);
  return r;
}

type Proj = { configured?: boolean; mode?: string; data: Array<{ name: string }> };
/** Route the mocked admin-service by URL: legacy list vs composition projection, per tenant. */
function mockAdmin(opts: {
  legacy: Record<string, string[]>;
  composition: Record<string, Proj | "down">;
}): { urls: string[] } {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      const tid = /([0-9a-f]{8}-[0-9a-f-]{27})/i.exec(url)?.[1] ?? "";
      if (url.includes("/composition/internal/")) {
        const c = opts.composition[tid];
        if (!c || c === "down") return { ok: false, status: 503, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => c };
      }
      return { ok: true, status: 200, json: async () => ({ data: (opts.legacy[tid] ?? []).map((name) => ({ name })) }) };
    }),
  );
  return { urls };
}
const compUrls = (urls: string[]) => urls.filter((u) => u.includes("/composition/internal/"));
const legacyUrls = (urls: string[]) => urls.filter((u) => u.includes("/modules-list"));

const REC = "/api/v1/hrms/recruitment/openings";
const LEAVE = "/api/v1/hrms/leave/apply";
const CORE = "/api/v1/hrms/employees/1";

// The admin circuit breaker is module-level state shared by every test in the file (3 consecutive failures open it
// for 10 s). Each test starts 30 s later on a faked Date, so an outage test can never leave it open for the next.
let clock = Date.now();
beforeEach(() => {
  clock += 30_000;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
  _test.moduleCache.clear();
  _test.lastKnownMode.clear();
  _test.lastKnownAllowList.clear();
  _test.resetShadowCount();
  moduleGuardWouldDenyTotal.reset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("env unset (default): byte-for-byte today", () => {
  it("uses only the legacy list, never fetches the composition projection, even for a tenant stored as enforce", async () => {
    const { urls } = mockAdmin({
      legacy: { [A]: ["hrms", "payroll"] },
      composition: { [A]: { configured: true, mode: "enforce", data: [{ name: "workforce_core" }] } },
    });
    expect(await checkModuleEnabled(fakeReq(A), fakeReply(), "hrms", REC)).toBe(true);
    const reply = fakeReply();
    expect(await checkModuleEnabled(fakeReq(A), reply, "finance", "/api/v1/finance/x")).toBe(false);
    expect(reply._code).toBe(403);
    expect(compUrls(urls)).toEqual([]);
    expect(_test.shadowWouldDenyCount).toBe(0);
  });

  it("GATEWAY_TENANT_MODULE_MODE other than 'on' is also off", async () => {
    vi.stubEnv("GATEWAY_TENANT_MODULE_MODE", "shadow");
    const { urls } = mockAdmin({ legacy: { [A]: ["hrms"] }, composition: {} });
    expect(await checkModuleEnabled(fakeReq(A), fakeReply(), "hrms", REC)).toBe(true);
    expect(compUrls(urls)).toEqual([]);
  });
});

describe("per-tenant mode ON, tenant mode off (the default for every tenant)", () => {
  beforeEach(() => vi.stubEnv("GATEWAY_TENANT_MODULE_MODE", "on"));

  it("decides exactly like legacy: coarse hrms reaches recruitment AND leave, no would-deny noise", async () => {
    const warns: unknown[] = [];
    mockAdmin({
      legacy: { [A]: ["hrms"] },
      composition: { [A]: { configured: true, mode: "off", data: [{ name: "workforce_core" }] } },
    });
    expect(await checkModuleEnabled(fakeReq(A, warns), fakeReply(), "hrms", REC)).toBe(true);
    expect(await checkModuleEnabled(fakeReq(A, warns), fakeReply(), "hrms", LEAVE)).toBe(true);
    expect(_test.shadowWouldDenyCount).toBe(0);
    expect(warns).toEqual([]);
  });

  it("a module legacy omits is still refused", async () => {
    mockAdmin({ legacy: { [A]: ["hrms"] }, composition: { [A]: { configured: true, mode: "off", data: [] } } });
    const reply = fakeReply();
    expect(await checkModuleEnabled(fakeReq(A), reply, "finance", "/api/v1/finance/x")).toBe(false);
    expect(reply._body.code).toBe("MODULE_DISABLED");
  });

  it("composition admin outage or an un-onboarded tenant falls back to off (legacy)", async () => {
    mockAdmin({ legacy: { [A]: ["hrms"], [B]: ["hrms"] }, composition: { [A]: "down", [B]: { configured: false, mode: "off", data: [] } } });
    expect(await checkModuleEnabled(fakeReq(A), fakeReply(), "hrms", REC)).toBe(true);
    expect(await checkModuleEnabled(fakeReq(B), fakeReply(), "hrms", REC)).toBe(true);
  });

  it("no tenant header: legacy allow, no fetch at all", async () => {
    const { urls } = mockAdmin({ legacy: {}, composition: {} });
    expect(await checkModuleEnabled(fakeReq(undefined), fakeReply(), "hrms", REC)).toBe(true);
    expect(urls).toEqual([]);
  });
});

describe("per-tenant mode ON, tenant mode shadow (watch-only)", () => {
  beforeEach(() => vi.stubEnv("GATEWAY_TENANT_MODULE_MODE", "on"));
  // The tenant bought HR core + leave, NOT recruitment or payroll. Legacy cannot express that: it has coarse `hrms`.
  const comp = (): Proj => ({ configured: true, mode: "shadow", data: [{ name: "workforce_core" }, { name: "hrms-leave" }] });

  it("never blocks: the recruitment request the per-module mode would refuse is allowed, logged and counted", async () => {
    const warns: any[] = [];
    mockAdmin({ legacy: { [A]: ["hrms"] }, composition: { [A]: comp() } });
    for (let i = 0; i < 5; i++) {
      const reply = fakeReply();
      expect(await checkModuleEnabled(fakeReq(A, warns), reply, "hrms", REC)).toBe(true);
      expect(reply._code).toBe(200);
    }
    expect(_test.shadowWouldDenyCount).toBe(5);
    expect(warns).toHaveLength(5);
    expect(warns[0].event).toBe("module_guard_would_deny");
    expect(String(warns[0].reason)).toContain("tenant_mode_watch_only");
    const metric = await moduleGuardWouldDenyTotal.get();
    expect(metric.values.reduce((n, v) => n + v.value, 0)).toBe(5);
    expect(metric.values[0]!.labels).not.toHaveProperty("tenantId");
  });

  it("requests the per-module mode would allow produce no would-deny", async () => {
    mockAdmin({ legacy: { [A]: ["hrms"] }, composition: { [A]: comp() } });
    expect(await checkModuleEnabled(fakeReq(A), fakeReply(), "hrms", LEAVE)).toBe(true);
    expect(await checkModuleEnabled(fakeReq(A), fakeReply(), "hrms", CORE)).toBe(true);
    expect(_test.shadowWouldDenyCount).toBe(0);
  });

  it("legacy stays authoritative: a request legacy refuses is refused in watch-only too", async () => {
    mockAdmin({ legacy: { [A]: ["hrms"] }, composition: { [A]: { ...comp(), data: [{ name: "finance" }] } } });
    const reply = fakeReply();
    expect(await checkModuleEnabled(fakeReq(A), reply, "finance", "/api/v1/finance/x")).toBe(false);
    expect(reply._code).toBe(403);
  });

  it("the dry run never writes to the real reply", async () => {
    mockAdmin({ legacy: { [A]: ["hrms"] }, composition: { [A]: comp() } });
    const reply = fakeReply();
    const send = vi.spyOn(reply, "send");
    await checkModuleEnabled(fakeReq(A), reply, "hrms", REC);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("per-tenant mode ON, tenant mode enforce", () => {
  beforeEach(() => vi.stubEnv("GATEWAY_TENANT_MODULE_MODE", "on"));
  const comp = (): Proj => ({ configured: true, mode: "enforce", data: [{ name: "workforce_core" }, { name: "hrms-leave" }] });

  it("uses the per-module list: recruitment is refused although legacy would allow it; leave and core pass", async () => {
    mockAdmin({ legacy: { [A]: ["hrms"] }, composition: { [A]: comp() } });
    const reply = fakeReply();
    expect(await checkModuleEnabled(fakeReq(A), reply, "hrms", REC)).toBe(false);
    expect(reply._code).toBe(403);
    expect(reply._body.message).toContain("hrms-recruitment");
    expect(await checkModuleEnabled(fakeReq(A), fakeReply(), "hrms", LEAVE)).toBe(true);
    expect(await checkModuleEnabled(fakeReq(A), fakeReply(), "hrms", CORE)).toBe(true);
  });

  it("fails CLOSED when the composition projection is unreachable for a tenant seen as enforce (503, retryable)", async () => {
    const m = mockAdmin({ legacy: { [A]: ["hrms"] }, composition: { [A]: comp() } });
    expect(await checkModuleEnabled(fakeReq(A), fakeReply(), "hrms", LEAVE)).toBe(true);
    _test.moduleCache.clear(); // TTL expiry; sticky mode survives
    mockAdmin({ legacy: { [A]: ["hrms"] }, composition: { [A]: "down" } });
    const reply = fakeReply();
    expect(await checkModuleEnabled(fakeReq(A), reply, "hrms", LEAVE)).toBe(false);
    expect(reply._code).toBe(503);
    expect(reply._body.code).toBe("MODULE_GUARD_UNAVAILABLE");
    expect(m.urls.length).toBeGreaterThan(0);
  });

  it("an unmapped route is refused (fail closed) in enforce", async () => {
    mockAdmin({ legacy: { [A]: [] }, composition: { [A]: comp() } });
    expect(await checkModuleEnabled(fakeReq(A), fakeReply(), "totally-unknown")).toBe(false);
  });

  it("platform routes always pass", async () => {
    mockAdmin({ legacy: {}, composition: { [A]: comp() } });
    expect(await checkModuleEnabled(fakeReq(A), fakeReply(), "identity")).toBe(true);
  });
});

describe("tenant isolation and caching", () => {
  beforeEach(() => vi.stubEnv("GATEWAY_TENANT_MODULE_MODE", "on"));

  it("interleaved tenants in different modes never share a decision", async () => {
    mockAdmin({
      legacy: { [A]: ["hrms"], [B]: ["hrms"] },
      composition: {
        [A]: { configured: true, mode: "enforce", data: [{ name: "workforce_core" }] },
        [B]: { configured: true, mode: "off", data: [] },
      },
    });
    for (let i = 0; i < 3; i++) {
      expect(await checkModuleEnabled(fakeReq(A), fakeReply(), "hrms", REC)).toBe(false); // A: per-module, no recruitment
      expect(await checkModuleEnabled(fakeReq(B), fakeReply(), "hrms", REC)).toBe(true); //  B: legacy
    }
  });

  it("an enforce tenant's outage does not fail a different off tenant closed", async () => {
    mockAdmin({
      legacy: { [A]: ["hrms"], [B]: ["hrms"] },
      composition: { [A]: { configured: true, mode: "enforce", data: [{ name: "workforce_core" }] }, [B]: { configured: true, mode: "off", data: [] } },
    });
    await checkModuleEnabled(fakeReq(A), fakeReply(), "hrms", CORE);
    await checkModuleEnabled(fakeReq(B), fakeReply(), "hrms", CORE);
    _test.moduleCache.clear();
    mockAdmin({ legacy: { [A]: ["hrms"], [B]: ["hrms"] }, composition: { [A]: "down", [B]: "down" } });
    expect(await checkModuleEnabled(fakeReq(A), fakeReply(), "hrms", CORE)).toBe(false);
    expect(await checkModuleEnabled(fakeReq(B), fakeReply(), "hrms", CORE)).toBe(true);
  });

  it("each source is fetched once per tenant inside the TTL", async () => {
    const { urls } = mockAdmin({ legacy: { [A]: ["hrms"] }, composition: { [A]: { configured: true, mode: "shadow", data: [{ name: "workforce_core" }] } } });
    for (let i = 0; i < 4; i++) await checkModuleEnabled(fakeReq(A), fakeReply(), "hrms", REC);
    expect(compUrls(urls)).toHaveLength(1);
    expect(legacyUrls(urls)).toHaveLength(1);
  });

  it("invalidateModuleCache drops both sources, so a mode flip is picked up immediately", async () => {
    mockAdmin({ legacy: { [A]: ["hrms"] }, composition: { [A]: { configured: true, mode: "off", data: [{ name: "workforce_core" }] } } });
    expect(await checkModuleEnabled(fakeReq(A), fakeReply(), "hrms", REC)).toBe(true);
    mockAdmin({ legacy: { [A]: ["hrms"] }, composition: { [A]: { configured: true, mode: "enforce", data: [{ name: "workforce_core" }] } } });
    expect(await checkModuleEnabled(fakeReq(A), fakeReply(), "hrms", REC)).toBe(true); // still cached off
    invalidateModuleCache(A);
    expect(await checkModuleEnabled(fakeReq(A), fakeReply(), "hrms", REC)).toBe(false);
  });

  it("COMPOSITION_ENFORCEMENT=on keeps its process-wide meaning and wins (no legacy fetch)", async () => {
    vi.stubEnv("COMPOSITION_ENFORCEMENT", "on");
    const { urls } = mockAdmin({ legacy: { [A]: ["hrms"] }, composition: { [A]: { configured: true, mode: "off", data: [{ name: "workforce_core" }] } } });
    expect(await checkModuleEnabled(fakeReq(A), fakeReply(), "hrms", CORE)).toBe(true);
    expect(legacyUrls(urls)).toEqual([]);
  });
});
