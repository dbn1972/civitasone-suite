import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { POST as otpRequest } from "./otp-request/route";
import { POST as otpVerify } from "./otp-verify/route";

/** V4-A-06: header x-tenant-id and body tenantId must always be the same, validated UUID. */
describe.each([
  ["otp-request", otpRequest],
  ["otp-verify", otpVerify],
])("careers %s tenant binding", (_name, handler) => {
  const fetchMock = vi.fn();
  const post = (body: unknown) =>
    handler(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}", { status: 400, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["non-uuid string", "not-a-uuid"],
    ["number", 42],
    ["object", { $ne: null }],
  ])("rejects a %s tenantId with 400 and never calls upstream", async (_n, tenantId) => {
    const res = await post({ email: "a@b.in", tenantId });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses one valid tenant for both header and body", async () => {
    const tenantId = globalThis.crypto.randomUUID();
    await post({ email: "a@b.in", tenantId });
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers["x-tenant-id"]).toBe(tenantId);
    expect(JSON.parse(init.body).tenantId).toBe(tenantId);
  });

  it("header and body agree when no tenantId is supplied", async () => {
    await post({ email: "a@b.in" });
    const init = fetchMock.mock.calls[0][1];
    expect(JSON.parse(init.body).tenantId).toBe(init.headers["x-tenant-id"]);
  });
});
