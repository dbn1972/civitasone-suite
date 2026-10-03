import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchApplication } from "./fetchApplication";

const opts = { gateway: "http://gw", fallbackTenantId: "t-fallback" };
const token = `${Buffer.from(JSON.stringify({ tenantId: "t-1" })).toString("base64url")}.sig`;
const detail = { id: "a1", applicationNo: "APP-1", stage: "applied", status: "active", appliedAt: "2026-03-01T10:00:00Z", job: null, timeline: [] };

function stubFetch(res: Response | Error) {
  const f = vi.fn(async (_url: string, _init?: RequestInit) => { if (res instanceof Error) throw res; return res; });
  vi.stubGlobal("fetch", f);
  return f;
}

describe("fetchApplication (GAP-RECRUITMENT-CAREERS-PORTAL-APPLICATION-DETAIL-03)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns ok with the body and sends the tenant from the token", async () => {
    const f = stubFetch(new Response(JSON.stringify(detail), { status: 200 }));
    const r = await fetchApplication(token, "a1", opts);
    expect(r).toMatchObject({ kind: "ok", app: { id: "a1" } });
    const init = f.mock.calls[0]![1] as { headers: Record<string, string> };
    expect(init.headers["x-tenant-id"]).toBe("t-1");
  });

  it("maps 404 to notfound", async () => {
    stubFetch(new Response("{}", { status: 404 }));
    expect(await fetchApplication(token, "a1", opts)).toEqual({ kind: "notfound" });
  });

  it.each([401, 403])("maps %i (expired / invalid session) to unauthorized, not notfound", async (status) => {
    stubFetch(new Response("{}", { status }));
    expect(await fetchApplication(token, "a1", opts)).toEqual({ kind: "unauthorized" });
  });

  it("maps a malformed token to unauthorized without calling the service", async () => {
    const f = stubFetch(new Response("{}", { status: 200 }));
    expect(await fetchApplication("garbage", "a1", opts)).toEqual({ kind: "unauthorized" });
    expect(f).not.toHaveBeenCalled();
  });

  it("maps 500 and network failures to error (an outage, not a 404)", async () => {
    stubFetch(new Response("{}", { status: 500 }));
    expect(await fetchApplication(token, "a1", opts)).toEqual({ kind: "error" });
    stubFetch(new Error("ECONNRESET"));
    expect(await fetchApplication(token, "a1", opts)).toEqual({ kind: "error" });
  });
});
