/**
 * Gateway module-guard — enforcement decisions.
 *   • platform / unknown / no-tenant routes always pass (fail-open)
 *   • COMPOSITION_ENFORCEMENT=on sources the allow-list from the composition
 *     engine; configured:false ⇒ fail open; enabled ⇒ pass, disabled ⇒ 403
 *   • flag off keeps the legacy modules-list behaviour
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkModuleEnabled, _test } from "../src/module-guard.js";

const TID = "11111111-2222-4000-8000-000000000001";

function fakeReq(tid?: string): any {
  return { headers: tid ? { "x-tenant-id": tid } : {}, id: "req-test" };
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
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterEach(() => vi.restoreAllMocks());

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
});

describe("composition enforcement mode", () => {
  it("fails OPEN for an un-onboarded tenant (configured:false)", async () => {
    vi.stubEnv("COMPOSITION_ENFORCEMENT", "on");
    mockFetch({ configured: false, data: [] });
    expect(await checkModuleEnabled(fakeReq(TID), fakeReply(), "finance")).toBe(true);
  });

  it("allows an enabled module and 403s a disabled one", async () => {
    vi.stubEnv("COMPOSITION_ENFORCEMENT", "on");
    mockFetch({ configured: true, data: [{ name: "finance" }, { name: "hrms" }] });
    expect(await checkModuleEnabled(fakeReq(TID), fakeReply(), "finance")).toBe(true);

    _test.moduleCache.clear();
    const reply = fakeReply();
    expect(await checkModuleEnabled(fakeReq(TID), reply, "procurement")).toBe(false);
    expect(reply._code).toBe(403);
    expect(reply._body.code).toBe("MODULE_DISABLED");
  });
});

describe("legacy modules-list mode (flag off)", () => {
  it("enforces the legacy allow-list", async () => {
    mockFetch({ data: [{ name: "finance" }] }); // no `configured` field
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
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ configured: true, data: [{ name: "finance" }] }) }));
    vi.stubGlobal("fetch", fetchSpy);
    await checkModuleEnabled(fakeReq(TID), fakeReply(), "finance");
    const [url, opts] = fetchSpy.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toContain(`/v1/admin/composition/internal/${TID}/modules`);
    expect(opts.headers["x-internal"]).toBe("1");
    expect(opts.headers["x-tenant-id"]).toBe(TID);
    expect(opts.headers["x-service-secret"]).toBe("s3cr3t");
  });

  it("legacy mode keeps the modules-list URL + x-internal-secret header", async () => {
    vi.stubEnv("INTERNAL_SERVICE_SECRET", "s3cr3t");
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ name: "finance" }] }) }));
    vi.stubGlobal("fetch", fetchSpy);
    await checkModuleEnabled(fakeReq(TID), fakeReply(), "finance");
    const [url, opts] = fetchSpy.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toContain(`/v1/admin/tenants/${TID}/modules-list`);
    expect(opts.headers["x-internal-secret"]).toBe("s3cr3t");
    expect(opts.headers["x-internal"]).toBeUndefined();
  });
});
