import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => ({ value: "test-token" }) }),
}));

import { POST as markRead } from "./mark-read/route";
import { GET as unread } from "./stream/unread/route";
import { GET as stream } from "./stream/route";

/** V4-A-05: notification proxies must return the JSON envelope when the gateway is down. */
describe("notification proxies upstream failure", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("mark-read -> 502 UPSTREAM_UNAVAILABLE with a timeout signal", async () => {
    const res = await markRead(new Request("http://localhost/api/notification/mark-read", { method: "POST", body: "{}" }));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("UPSTREAM_UNAVAILABLE");
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("stream/unread -> 502 UPSTREAM_UNAVAILABLE with a timeout signal", async () => {
    const res = await unread(new Request("http://localhost/api/notification/stream/unread"));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("UPSTREAM_UNAVAILABLE");
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("stream (SSE) -> 502 UPSTREAM_UNAVAILABLE", async () => {
    const res = await stream(new Request("http://localhost/api/notification/stream"));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("UPSTREAM_UNAVAILABLE");
  });
});
