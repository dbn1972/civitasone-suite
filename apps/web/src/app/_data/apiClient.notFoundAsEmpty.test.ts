import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));

import { fetchJson, isRecordNotFound } from "./apiClient";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    clone() {
      return jsonResponse(status, body);
    },
  } as unknown as Response;
}

// UAT-P2-D1: /platform-admin/tenant-config, /tenant-admin/org-type,
// /tenant/overview and /themes/branding all showed "We couldn't load ..."
// because the service's honest "nothing on record for this office" 404 was
// treated exactly like an outage.
describe("fetchJson notFoundAsEmpty (UAT-P2-D1)", () => {
  const options = { telemetryKey: "test.key", mapResponse: (p: unknown) => p as unknown };

  beforeEach(() => {
    mockGet.mockReturnValue({ value: "fake-access-token" });
    process.env.CIVITASONE_API_BASE_URL = "http://gateway.test";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CIVITASONE_API_BASE_URL;
  });

  it("a service NOT_FOUND 404 becomes an empty api result when opted in", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, { code: "NOT_FOUND", message: "tenant not found" })));
    const result = await fetchJson("/api/v1/tenants/current", [], { ...options, notFoundAsEmpty: true });
    expect(result).toEqual({ data: [], source: "api", status: 404, errorCode: "NOT_FOUND", errorMessage: "tenant not found" });
  });

  it("without the option the same 404 is still an error (existing loaders unchanged)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, { code: "NOT_FOUND", message: "tenant not found" })));
    const result = await fetchJson("/api/v1/tenants/current", [], options);
    expect(result.source).toBe("error");
    expect(result.status).toBe(404);
  });

  it("a gateway 'no upstream for path' 404 is never hidden", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, { code: "NOT_FOUND", message: "no upstream for path" })));
    const result = await fetchJson("/api/v1/nowhere", [], { ...options, notFoundAsEmpty: true });
    expect(result.source).toBe("error");
  });

  it("an untyped route-not-found 404 (Fastify default body) is never hidden", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(404, { message: "Route GET:/v1/x not found", error: "Not Found", statusCode: 404 })),
    );
    const result = await fetchJson("/api/v1/x", [], { ...options, notFoundAsEmpty: true });
    expect(result.source).toBe("error");
  });

  it("other failures (500) stay errors even when opted in", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { code: "INTERNAL", message: "internal error" })));
    const result = await fetchJson("/api/v1/x", [], { ...options, notFoundAsEmpty: true });
    expect(result.source).toBe("error");
    expect(result.status).toBe(500);
  });

  it("isRecordNotFound only accepts a typed, service-level 404", () => {
    expect(isRecordNotFound(404, "NOT_FOUND", "branding not configured")).toBe(true);
    expect(isRecordNotFound(404, "NOT_FOUND", "no upstream for path")).toBe(false);
    expect(isRecordNotFound(404, undefined, undefined)).toBe(false);
    expect(isRecordNotFound(403, "NOT_FOUND", "x")).toBe(false);
  });
});
