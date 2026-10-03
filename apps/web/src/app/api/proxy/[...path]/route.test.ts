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
        "x-bank-file-signed": "true",
        "x-bank-file-signature-format": "pgp_detached",
        "x-bank-file-sha256": "ab".repeat(32),
        "x-bank-file-encrypted": "false",
        "x-bank-file-issuance-id": "iss-1",
        "x-internal-debug": "must-not-pass",
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
    expect(res.headers.get("x-bank-file-signed")).toBe("true");
    // GAP-PAYROLL-DISBURSEMENT-03: what the server did with the file + the id for its signature
    expect(res.headers.get("x-bank-file-signature-format")).toBe("pgp_detached");
    expect(res.headers.get("x-bank-file-sha256")).toBe("ab".repeat(32));
    expect(res.headers.get("x-bank-file-encrypted")).toBe("false");
    expect(res.headers.get("x-bank-file-issuance-id")).toBe("iss-1");
    expect(res.headers.get("x-internal-debug")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("still passes JSON through unchanged", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const res = await GET(new Request("http://localhost/api/proxy/v1/x"), { params: { path: ["v1", "x"] } });
    expect(await res.json()).toEqual({ ok: true });
  });
});

// GAP-ASSETS-BULK-IMPORT-04: the proxy allow-list forwards only x-idempotency-key,
// so that is the header the bulk importer must send for asset-service to see it.
describe("BFF proxy idempotency header allow-list", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response("{}", { status: 202, headers: { "content-type": "application/json" } }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("forwards x-idempotency-key upstream and drops a bare idempotency-key", async () => {
    await POST(
      new Request("http://localhost/api/proxy/v1/asset/bulk/import", {
        method: "POST", body: "{}", headers: { "x-idempotency-key": "k-12345678", "idempotency-key": "dropped-1234" },
      }),
      { params: { path: ["v1", "asset", "bulk", "import"] } },
    );
    const sent = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
    expect(sent["x-idempotency-key"]).toBe("k-12345678");
    expect(sent["idempotency-key"]).toBeUndefined();
  });
});
