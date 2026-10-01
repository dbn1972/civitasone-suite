import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => ({ value: "test-token" }) }),
}));

import { GET, POST } from "./route";

/**
 * GAP-PAYROLL-DISBURSEMENT-02/03: the BFF proxy used `upstream.text()` and
 * dropped every response header except content-type -- which corrupted a
 * binary NACH ZIP and lost the bank file's filename and signed status.
 */
describe("BFF proxy response passthrough", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("passes binary bodies through byte-for-byte with download headers", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x00, 0x80]);
    fetchMock.mockResolvedValue(new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="NACH_SBIN_1.zip"',
        "x-bank-file-signed": "false",
        "set-cookie": "should=not-pass",
      },
    }));
    const res = await POST(
      new Request("http://localhost/api/proxy/v1/payroll/runs/r1/bank-file", { method: "POST", body: "{}" }),
      { params: { path: ["v1", "payroll", "runs", "r1", "bank-file"] } },
    );
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="NACH_SBIN_1.zip"');
    expect(res.headers.get("x-bank-file-signed")).toBe("false");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("still passes JSON through unchanged", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const res = await GET(new Request("http://localhost/api/proxy/v1/x"), { params: { path: ["v1", "x"] } });
    expect(await res.json()).toEqual({ ok: true });
  });
});
