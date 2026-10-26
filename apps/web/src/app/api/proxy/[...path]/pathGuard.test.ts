import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => ({ value: "test-token" }) }),
}));

import { GET } from "./route";

/** V4-A-03: a single catch-all segment must never be able to steer the upstream URL out of /api/. */
describe("BFF proxy path guard", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const call = (path: string[]) =>
    GET(new Request("http://localhost/api/proxy/x"), { params: Promise.resolve({ path }) });

  it.each([
    ["encoded slash traversal", ["v1", "a/../../../internal/admin"]],
    ["backslash", ["v1", "a\\..\\..\\internal"]],
    ["question mark", ["v1", "a?x=1"]],
    ["hash", ["v1", "a#frag"]],
    ["dot-dot embedded", ["v1", "a..b/.."]],
    ["percent-encoded dot-dot", ["v1", "%2e%2e"]],
    ["double-encoded slash", ["v1", "a%2f..%2f..%2finternal"]],
    ["malformed escape", ["v1", "%E0%A4%A"]],
  ])("rejects %s with 400 and never calls upstream", async (_n, path) => {
    const res = await call(path);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("BAD_REQUEST");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still forwards a normal path under /api/", async () => {
    const res = await call(["v1", "payroll", "runs", "r1"]);
    expect(res.status).toBe(200);
    const target = new URL(fetchMock.mock.calls[0][0] as string);
    expect(target.pathname).toBe("/api/v1/payroll/runs/r1");
  });
});
