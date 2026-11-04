import { describe, it, expect, vi, afterEach } from "vitest";
import { afterPageLoad, loadViaProxy, proxyPathFor } from "./deferredLoad";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("deferredLoad (UX-R5 perf)", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("maps a gateway path onto the browser proxy", () => {
    expect(proxyPathFor("/api/v1/hrms/employees/e1/scanned-documents")).toBe("/api/proxy/v1/hrms/employees/e1/scanned-documents");
    expect(proxyPathFor("/v1/estab/files/f1")).toBe("/api/proxy/v1/estab/files/f1");
  });

  it("waits for the window load event before running when the page is still loading", () => {
    vi.useFakeTimers();
    const ready = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    const fn = vi.fn();
    afterPageLoad(fn);
    vi.runAllTimers();
    expect(fn).not.toHaveBeenCalled();
    ready.mockReturnValue("complete");
    window.dispatchEvent(new Event("load"));
    vi.runAllTimers();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("a cancelled wait never runs", () => {
    vi.useFakeTimers();
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    const fn = vi.fn();
    const cancel = afterPageLoad(fn);
    cancel();
    window.dispatchEvent(new Event("load"));
    vi.runAllTimers();
    expect(fn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("returns the server loader shape: data, error with status/code/message, 404 as a real answer, malformed as error", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const map = (p: unknown) => (Array.isArray((p as { data?: unknown }).data) ? ((p as { data: string[] }).data) : null);

    fetchMock.mockResolvedValueOnce(json({ data: ["a"] }));
    expect(await loadViaProxy("/api/v1/x", [] as string[], map)).toEqual({ data: ["a"], source: "api", status: 200 });

    fetchMock.mockResolvedValueOnce(json({ code: "FORBIDDEN", message: "no" }, 403));
    expect(await loadViaProxy("/api/v1/x", [] as string[], map)).toEqual({ data: [], source: "error", status: 403, errorCode: "FORBIDDEN", errorMessage: "no" });

    fetchMock.mockResolvedValueOnce(json({ code: "NOT_FOUND" }, 404));
    expect(await loadViaProxy<string[] | null>("/api/v1/x", null, map, { notFoundAs: null })).toEqual({ data: null, source: "api", status: 404 });

    fetchMock.mockResolvedValueOnce(json({ nope: true }));
    expect((await loadViaProxy("/api/v1/x", [] as string[], map)).source).toBe("error");

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await loadViaProxy("/api/v1/x", [] as string[], map)).toEqual({ data: [], source: "error" });
  });
});
