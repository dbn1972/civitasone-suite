import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => ({ value: "test-token" }) }),
}));

import { GET } from "./route";

/** V4-A-05: a gateway outage must yield the JSON envelope, not an unhandled rejection. */
describe("BFF proxy upstream failure", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const call = () =>
    GET(new Request("http://localhost/api/proxy/v1/x"), { params: Promise.resolve({ path: ["v1", "x"] }) });

  it("returns JSON 502 UPSTREAM_UNAVAILABLE when fetch rejects", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed: ECONNREFUSED"));
    const res = await call();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
  });

  it("returns JSON 502 when reading the upstream body fails", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      headers: new Headers(),
      arrayBuffer: () => Promise.reject(new Error("terminated")),
    });
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("passes an AbortSignal timeout to the upstream call", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await call();
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
