import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchReportingLine } from "../src/shared/hrms-client.js";

const T = "11111111-1111-4111-8111-111111111111", A = "22222222-2222-4222-8222-222222222222", M = "33333333-3333-4333-8333-333333333333";
const TEST_SECRET = globalThis.crypto.randomUUID();
afterEach(() => { vi.unstubAllGlobals(); delete process.env.INTERNAL_SERVICE_SECRET; });
const NONE = { fullName: null, manager: null };

describe("fetchReportingLine (fail soft)", () => {
  it("parses a manager and sends the internal service headers", async () => {
    process.env.INTERNAL_SERVICE_SECRET = TEST_SECRET;
    const f = vi.fn(async () => new Response(JSON.stringify({ actorId: A, fullName: "Alice", manager: { actorId: M, fullName: "Meera" } })));
    vi.stubGlobal("fetch", f);
    expect(await fetchReportingLine(T, A)).toEqual({ fullName: "Alice", manager: { actorId: M, fullName: "Meera" } });
    const [url, init] = f.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toContain(`/v1/hrms/internal/employees/actor/${A}/reporting-line`);
    expect(init.headers).toMatchObject({ "x-internal": "1", "x-tenant-id": T });
  });
  it("no manager in the response -> manager null", async () => {
    process.env.INTERNAL_SERVICE_SECRET = TEST_SECRET;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ actorId: A, fullName: "Alice", manager: null }))));
    expect(await fetchReportingLine(T, A)).toEqual({ fullName: "Alice", manager: null });
  });
  it("non-2xx, network error, malformed body and missing secret all return nothing, never throw", async () => {
    process.env.INTERNAL_SERVICE_SECRET = TEST_SECRET;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    expect(await fetchReportingLine(T, A)).toEqual(NONE);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    expect(await fetchReportingLine(T, A)).toEqual(NONE);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json")));
    expect(await fetchReportingLine(T, A)).toEqual(NONE);
    delete process.env.INTERNAL_SERVICE_SECRET;
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await fetchReportingLine(T, A)).toEqual(NONE);
    expect(f).not.toHaveBeenCalled();
  });
});
