/**
 * Gateway module-guard — enforcement decisions, mode-aware (ST-M01-02, D-ST-24).
 *
 * Three per-tenant modes, sourced from the admin composition projection:
 *   • off     — the pre-FF-03 fail-OPEN behaviour (default). Every assertion in
 *               the "bypass paths", "legacy modules-list mode", and
 *               "service-to-service auth headers" blocks below is preserved
 *               verbatim: off = current behaviour, unchanged.
 *   • shadow  — would-deny is logged + counted but the request is ALLOWED.
 *   • enforce — fail CLOSED on a disabled module, an unmapped route, a missing
 *               tenant, an admin outage / open breaker, and configured:false.
 *
 * Assertions are ADDED, never removed: the off-mode blocks are the original
 * fail-open contract; the shadow/enforce blocks are the new mode-gated contract.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkModuleEnabled, _test } from "../src/module-guard.js";

const TID = "11111111-2222-4000-8000-000000000001";

function fakeReq(tid?: string): any {
  return { headers: tid ? { "x-tenant-id": tid } : {}, id: "req-test", log: { warn() {} } };
}
function fakeReply(): any {
  const r: any = { _code: 200, _body: null };
  r.code = (n: number) => ((r._code = n), r);
  r.send = (b: any) => ((r._body = b), r);
  return r;
}
function mockFetch(payload: unknown, ok = true): void {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => payload })));
}

beforeEach(() => {
  _test.moduleCache.clear();
  _test.lastKnownMode.clear();
  _test.resetShadowCount();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterEach(() => vi.restoreAllMocks());

// ─────────────────────────────────────────────────────────────────────────
// off mode (default) — the original fail-open contract, UNCHANGED
// ─────────────────────────────────────────────────────────────────────────
describe("bypass paths (always allow)", () => {
  it("allows platform routes without an admin call", async () => {
    expect(await checkModuleEnabled(fakeReq(TID), fakeReply(), "identity")).toBe(true);
  });
  it("allows unknown routes (conservative)", async () => {
    expect(await checkModuleEnabled(fakeReq(TID), fakeReply(), "totally-unknown")).toBe(true);
  });
  it("allows when there is no tenant context", async () => {
    expect(await checkModuleEnabled(fakeReq(undefined), fakeReply(), "finance")).toBe(true);
  });
  // ST-M01-02 composition-projection fix: documents/eoffice are platform routes
  // and must stay reachable in every mode (spec §1).
  it("allows documents + eoffice as platform routes without an admin call", async () => {
    expect(await checkModuleEnabled(fakeReq(TID), fakeReply(), "documents")).toBe(true);
    expect(await checkModuleEnabled(fakeReq(TID), fakeReply(), "eoffice")).toBe(true);
  });
});

describe("composition enforcement mode", () => {
  it("fails OPEN for an un-onboarded tenant (configured:false)", async () => {
    vi.stubEnv("COMPOSITION_ENFORCEMENT", "on");
    mockFetch({ configured: false, data: [] }); // no `mode` ⇒ off
    expect(await checkModuleEnabled(fakeReq(TID), fakeReply(), "finance")).toBe(true);
  });

  it("allows an enabled module and 403s a disabled one", async () => {
    vi.stubEnv("COMPOSITION_ENFORCEMENT", "on");
    // mode:enforce so a disabled module 403s (the pre-ST-M01-02 test used the
    // flag alone; the decision is now explicitly mode-gated).
    mockFetch({ configured: true, mode: "enforce", data: [{ name: "finance" }, { name: "hrms" }] });
    expect(await checkModuleEnabled(fakeReq(TID), fakeReply(), "finance")).toBe(true);

    _test.moduleCache.clear();
    const reply = fakeReply();
    expect(await checkModuleEnabled(fakeReq(TID), reply, "procurement")).toBe(false);
    expect(reply._code).toBe(403);
    expect(reply._body.code).toBe("MODULE_DISABLED");
  });

  it("in off mode a KNOWN-disabled module still 403s (pre-FF-03 enforcement preserved)", async () => {
    vi.stubEnv("COMPOSITION_ENFORCEMENT", "on");
    mockFetch({ configured: true, mode: "off", data: [{ name: "finance" }] });
    const reply = fakeReply();
    expect(await checkModuleEnabled(fakeReq(TID), reply, "procurement")).toBe(false);
    expect(reply._code).toBe(403);
    expect(reply._body.code).toBe("MODULE_DISABLED");
  });

  it("in off mode an ambiguous signal (configured:false) still fails OPEN", async () => {
    vi.stubEnv("COMPOSITION_ENFORCEMENT", "on");
    mockFetch({ configured: false, mode: "off", data: [] });
    const reply = fakeReply();
    expect(await checkModuleEnabled(fakeReq(TID), reply, "procurement")).toBe(true);
    expect(reply._code).toBe(200);
  });
});

describe("legacy modules-list mode (flag off)", () => {
  it("enforces the legacy allow-list (known-disabled module 403s; mode=off)", async () => {
    // UNCHANGED from the pre-ST-M01-02 contract: the legacy modules-list path
    // carries no `mode`, so its effective mode is `off`; a KNOWN allow-list that
    // omits the requested module still 403s (this was never one of the fail-open
    // signals). Only the ambiguous signals (unknown route / no tenant / outage /
    // configured:false) are mode-gated.
    mockFetch({ data: [{ name: "finance" }] }); // no `configured`, no `mode`
    expect(await checkModuleEnabled(fakeReq(TID), fakeReply(), "finance")).toBe(true);

    _test.moduleCache.clear();
    const reply = fakeReply();
    expect(await checkModuleEnabled(fakeReq(TID), reply, "hrms")).toBe(false);
    expect(reply._code).toBe(403);
  });
});

describe("service-to-service auth headers", () => {
  it("composition mode uses the x-internal / x-service-secret contract + composition URL", async () => {
    vi.stubEnv("COMPOSITION_ENFORCEMENT", "on");
    vi.stubEnv("INTERNAL_SERVICE_SECRET", "s3cr3t");
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ configured: true, mode: "off", data: [{ name: "finance" }] }) }));
    vi.stubGlobal("fetch", fetchSpy);
    await checkModuleEnabled(fakeReq(TID), fakeReply(), "finance");
    const [url, opts] = fetchSpy.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toContain(`/v1/admin/composition/internal/${TID}/modules`);
    expect(opts.headers["x-internal"]).toBe("1");
    expect(opts.headers["x-tenant-id"]).toBe(TID);
    expect(opts.headers["x-service-secret"]).toBe("s3cr3t");
  });

  it("legacy mode keeps the modules-list URL + x-internal-secret header, plus the explicit x-internal flag", async () => {
    vi.stubEnv("INTERNAL_SERVICE_SECRET", "s3cr3t");
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ name: "finance" }] }) }));
    vi.stubGlobal("fetch", fetchSpy);
    await checkModuleEnabled(fakeReq(TID), fakeReply(), "finance");
    const [url, opts] = fetchSpy.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toContain(`/v1/admin/tenants/${TID}/modules-list`);
    expect(opts.headers["x-internal-secret"]).toBe("s3cr3t");
    expect(opts.headers["x-internal"]).toBe("1");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// enforce mode — fail CLOSED (the ST-M01-02 / D-ST-24 core)
// ─────────────────────────────────────────────────────────────────────────
describe("enforce mode fails closed", () => {
  beforeEach(() => vi.stubEnv("COMPOSITION_ENFORCEMENT", "on"));

  it("403s a disabled module", async () => {
    mockFetch({ configured: true, mode: "enforce", data: [{ name: "finance" }] });
    const reply = fakeReply();
    expect(await checkModuleEnabled(fakeReq(TID), reply, "payroll")).toBe(false);
    expect(reply._code).toBe(403);
    expect(reply._body.code).toBe("MODULE_DISABLED");
  });

  it("403s an unmapped route (no fail-open for unknown routes under enforce)", async () => {
    // The tenant is enforce; seed the cache with a known-mode fetch, then ask
    // for a route that has no ROUTE_TO_MODULE mapping.
    mockFetch({ configured: true, mode: "enforce", data: [{ name: "finance" }] });
    const reply = fakeReply();
    expect(await checkModuleEnabled(fakeReq(TID), reply, "totally-unknown")).toBe(false);
    expect(reply._code).toBe(403);
  });

  it("403s configured:false (un-onboarded tenant must not slip through)", async () => {
    mockFetch({ configured: false, mode: "enforce", data: [] });
    const reply = fakeReply();
    expect(await checkModuleEnabled(fakeReq(TID), reply, "finance")).toBe(false);
    expect(reply._code).toBe(403);
  });

  it("403s on an admin outage / open breaker once the tenant is known to be enforce", async () => {
    // First call: a good fetch establishes the tenant's enforce intent.
    mockFetch({ configured: true, mode: "enforce", data: [{ name: "finance" }] });
    expect(await checkModuleEnabled(fakeReq(TID), fakeReply(), "finance")).toBe(true);
    // Cache expires; admin-service is now unreachable.
    _test.moduleCache.clear();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const reply = fakeReply();
    expect(await checkModuleEnabled(fakeReq(TID), reply, "finance")).toBe(false);
    expect(reply._code).toBe(403);
  });

  it("still allows platform routes (documents/eoffice/identity) in enforce mode", async () => {
    mockFetch({ configured: true, mode: "enforce", data: [] });
    expect(await checkModuleEnabled(fakeReq(TID), fakeReply(), "documents")).toBe(true);
    expect(await checkModuleEnabled(fakeReq(TID), fakeReply(), "eoffice")).toBe(true);
    expect(await checkModuleEnabled(fakeReq(TID), fakeReply(), "identity")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// shadow mode — log/count would-deny, but ALLOW
// ─────────────────────────────────────────────────────────────────────────
describe("shadow mode logs would-deny but allows", () => {
  beforeEach(() => vi.stubEnv("COMPOSITION_ENFORCEMENT", "on"));

  it("allows a disabled module and increments the would-deny counter", async () => {
    mockFetch({ configured: true, mode: "shadow", data: [{ name: "finance" }] });
    const before = _test.shadowWouldDenyCount;
    const reply = fakeReply();
    expect(await checkModuleEnabled(fakeReq(TID), reply, "payroll")).toBe(true);
    expect(reply._code).toBe(200);
    expect(_test.shadowWouldDenyCount).toBe(before + 1);
  });

  it("allows configured:false and an unmapped route, counting both would-denies", async () => {
    mockFetch({ configured: false, mode: "shadow", data: [] });
    const before = _test.shadowWouldDenyCount;
    expect(await checkModuleEnabled(fakeReq(TID), fakeReply(), "finance")).toBe(true);
    _test.moduleCache.clear();
    mockFetch({ configured: true, mode: "shadow", data: [{ name: "finance" }] });
    expect(await checkModuleEnabled(fakeReq(TID), fakeReply(), "totally-unknown")).toBe(true);
    expect(_test.shadowWouldDenyCount).toBe(before + 2);
  });
});
