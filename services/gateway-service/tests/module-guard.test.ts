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
