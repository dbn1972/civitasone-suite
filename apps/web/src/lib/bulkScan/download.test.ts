import { describe, it, expect, vi, afterEach } from "vitest";
import { downloadScannedDocument, failureFromResponse, fetchPageImageUrl, FAILURE_KEYS, isRetryableRouteFailure } from "./download";

afterEach(() => vi.unstubAllGlobals());
const res = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });

describe("download and page-image routes", () => {
  it("clearance codes are told apart from plain 403 and 5xx", async () => {
    expect(await failureFromResponse(res(403, { code: "CLEARANCE_DENIED" }))).toBe("clearanceDenied");
    expect(await failureFromResponse(res(503, { code: "CLEARANCE_UNAVAILABLE" }))).toBe("clearanceUnavailable");
    expect(await failureFromResponse(res(403, { code: "FORBIDDEN" }))).toBe("forbidden");
    expect(await failureFromResponse(res(404, {}))).toBe("notFound");
    expect(await failureFromResponse({ status: 500, json: async () => { throw new Error("x"); } })).toBe("failed");
    expect(await failureFromResponse(res(404, { code: "VARIANT_UNAVAILABLE" }))).toBe("variantUnavailable");
    expect(new Set(Object.values(FAILURE_KEYS)).size).toBe(6);
  });
  it("only an unavailable clearance check (or a plain failure) is retryable", () => {
    expect(isRetryableRouteFailure("clearanceUnavailable")).toBe(true);
    expect(isRetryableRouteFailure("clearanceDenied")).toBe(false);
    expect(isRetryableRouteFailure("forbidden")).toBe(false);
    expect(isRetryableRouteFailure("notFound")).toBe(false);
  });
  it("downloads open the presigned URL; page images return it", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(200, { data: { downloadUrl: "https://s3/x" } })));
    expect(await downloadScannedDocument("d1", "searchable_pdf")).toEqual({ ok: true });
    expect(open).toHaveBeenCalledWith("https://s3/x", "_blank", "noopener,noreferrer");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(200, { data: { url: "https://s3/img" } })));
    expect(await fetchPageImageUrl("d1", 2)).toEqual({ ok: true, url: "https://s3/img" });
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe("/api/proxy/v1/documents/bulk-scan/files/d1/pages/2/image");
  });
  it("page-image route surfaces clearance failures and rejects unsafe URLs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(503, { code: "CLEARANCE_UNAVAILABLE" })));
    expect(await fetchPageImageUrl("d1", 1)).toEqual({ ok: false, failure: "clearanceUnavailable" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(200, { data: { url: "javascript:alert(1)" } })));
    expect(await fetchPageImageUrl("d1", 1)).toEqual({ ok: false, failure: "failed" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    expect(await downloadScannedDocument("d1")).toEqual({ ok: false, failure: "failed" });
  });
});

describe("downloadScannedDocument: streamed file and a response without a body reader", () => {
  it("a non-JSON success streams the file through a temporary link", async () => {
    const created = vi.fn(() => "blob:x");
    const revoked = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers({ "content-type": "application/pdf" }), blob: async () => new Blob(["x"]) }));
    expect(await downloadScannedDocument("d1", "original", "scan.pdf")).toEqual({ ok: true });
    expect(click).toHaveBeenCalledTimes(1);
    expect(revoked).toHaveBeenCalledWith("blob:x");
    click.mockRestore();
  });
  it("a failed response with no readable body falls back to the status", async () => {
    expect(await failureFromResponse({ status: 403 })).toBe("forbidden");
    expect(await failureFromResponse({ status: 500 })).toBe("failed");
  });
});
