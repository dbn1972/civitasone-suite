import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));

import { fetchJson } from "./apiClient";

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

describe("fetchJson", () => {
  const baseOptions = {
    telemetryKey: "test.key",
    mapResponse: (p: unknown) => p as unknown,
  };

  beforeEach(() => {
    mockGet.mockReturnValue({ value: "fake-access-token" });
    process.env.CIVITASONE_API_BASE_URL = "http://gateway.test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CIVITASONE_API_BASE_URL;
  });

  // The bug this closes: a 403 response's own body already carries a
  // specific, clerk-safe reason (every service's HttpError -> errorHandler
  // sends `{ code, message, ... }` -- see e.g.
  // services/hrms-service/src/modules/employee/routes.ts), but fetchJson
  // used to discard it entirely, leaving every caller unable to tell a
  // permanent authorization boundary apart from a transient failure.
  it("captures the backend's code and message from a 403 response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(403, {
          code: "FORBIDDEN",
          message: "managers may only view their own direct reports' records",
          correlationId: "corr-1",
          retryable: false,
        }),
      ),
    );

    const result = await fetchJson("/v1/hrms/employees/e1", null, baseOptions);

    expect(result).toEqual({
      data: null,
      source: "error",
      status: 403,
      errorCode: "FORBIDDEN",
      errorMessage: "managers may only view their own direct reports' records",
    });
  });

  it("still reports source:error and the status for a non-403 failure (e.g. 500) -- only additive fields change", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(500, { code: "INTERNAL", message: "internal error", correlationId: "corr-2" }),
      ),
    );

    const result = await fetchJson("/v1/hrms/employees/e1", null, baseOptions);

    expect(result.source).toBe("error");
    expect(result.status).toBe(500);
    expect(result.errorCode).toBe("INTERNAL");
  });

  it("degrades gracefully (no throw, no errorCode/errorMessage) when the error response isn't JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error("not json")),
        clone() {
          return this;
        },
      } as unknown as Response),
    );

    const result = await fetchJson("/v1/hrms/employees/e1", null, baseOptions);

    expect(result).toEqual({ data: null, source: "error", status: 502, errorCode: undefined, errorMessage: undefined });
  });

  it("leaves the successful path unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { ok: true })));

    const result = await fetchJson("/v1/hrms/employees/e1", null, {
      ...baseOptions,
      mapResponse: (p) => p,
    });

    expect(result).toEqual({ data: { ok: true }, source: "api" });
  });

  it("leaves the network-error path unchanged (no status, no body to read)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await fetchJson("/v1/hrms/employees/e1", null, baseOptions);

    expect(result).toEqual({ data: null, source: "error" });
  });
});
