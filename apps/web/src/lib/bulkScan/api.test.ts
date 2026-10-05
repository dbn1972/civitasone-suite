import { describe, it, expect, vi, afterEach } from "vitest";
import { bsRequest, isStale, qs, specificErrorKey, type ApiResult } from "./api";

afterEach(() => vi.unstubAllGlobals());
const fail = (status: number, code: string | null = null): Extract<ApiResult, { ok: false }> => ({ ok: false, status, code, message: null, reference: null });

describe("bsRequest", () => {
  it("calls the BFF proxy with JSON and returns the parsed body", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({ id: "x", status: "accepted" }) });
    vi.stubGlobal("fetch", f);
    const r = await bsRequest("/batches", { method: "POST", body: { a: 1 } });
    expect(r).toEqual({ ok: true, status: 202, json: { id: "x", status: "accepted" } });
    expect(f).toHaveBeenCalledWith("/api/proxy/v1/documents/bulk-scan/batches", expect.objectContaining({ method: "POST", body: '{"a":1}', cache: "no-store" }));
  });
  it("returns the server error code, and status 0 for a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: "STALE", message: "x" }) }));
    expect(await bsRequest("/x")).toEqual({ ok: false, status: 409, code: "STALE", message: "x", reference: null });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    expect(await bsRequest("/x")).toMatchObject({ ok: false, status: 0 });
  });
  it("keeps the support reference (correlation id) a failed response carried, and drops anything that is not an opaque id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, headers: new Headers({ "x-correlation-id": "abc-123-XYZ" }), json: async () => ({}) }));
    expect(await bsRequest("/x")).toMatchObject({ ok: false, status: 500, reference: "abc-123-XYZ" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, headers: new Headers({ "x-correlation-id": "<script>alert(1)</script>" }), json: async () => ({}) }));
    expect(await bsRequest("/x")).toMatchObject({ ok: false, reference: null });
  });
  it("builds query strings without empty values", () => {
    expect(qs({ a: "1", b: "", c: undefined, d: 0, e: null })).toBe("?a=1&d=0");
    expect(qs({})).toBe("");
  });
});

describe("error mapping", () => {
  it("detects a stale-version conflict and maps it to the reload prompt key", () => {
    expect(isStale(fail(409, "STALE"))).toBe(true);
    expect(isStale(fail(409, "STALE_VERSION"))).toBe(true);
    expect(isStale(fail(409, "NOT_PENDING"))).toBe(false);
    expect(specificErrorKey(fail(409, "STALE"))).toBe("apiError.STALE");
  });
  it("code-specific copy only for the bulk-scan catalogue codes; every generic situation takes the app standard (null)", () => {
    expect(specificErrorKey(fail(409, "MAKER_CHECKER_VIOLATION"))).toBe("apiError.MAKER_CHECKER_VIOLATION");
    expect(specificErrorKey(fail(403, "SUPER_ADMIN_REQUIRED"))).toBe("apiError.SUPER_ADMIN_REQUIRED");
    expect(specificErrorKey(fail(403, "FORBIDDEN"))).toBeNull();
    expect(specificErrorKey(fail(401))).toBeNull();
    expect(specificErrorKey(fail(0))).toBeNull();
    expect(specificErrorKey(fail(503))).toBeNull();
    expect(specificErrorKey(fail(404))).toBeNull();
    expect(specificErrorKey(fail(404, "NOT_FOUND"))).toBeNull();
    expect(specificErrorKey(fail(422, "WEIRD"))).toBeNull();
  });
});

describe("clearance errors", () => {
  it("map to distinct keys and only the 503 is retryable", async () => {
    const { isRetryableFailure } = await import("./api");
    expect(specificErrorKey(fail(403, "CLEARANCE_DENIED"))).toBe("apiError.CLEARANCE_DENIED");
    expect(specificErrorKey(fail(503, "CLEARANCE_UNAVAILABLE"))).toBe("apiError.CLEARANCE_UNAVAILABLE");
    expect(isRetryableFailure(fail(403, "CLEARANCE_DENIED"))).toBe(false);
    expect(isRetryableFailure(fail(503, "CLEARANCE_UNAVAILABLE"))).toBe(true);
    expect(isRetryableFailure(fail(0))).toBe(true);
    expect(isRetryableFailure(fail(404))).toBe(false);
  });
});
