import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));

import { getCagParas } from "./loaders";

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

describe("getCagParas mapResponse (GAP-AUDIT-CAG-01/02/04)", () => {
  beforeEach(() => {
    mockGet.mockReturnValue({ value: "fake-access-token" });
    process.env.CIVITASONE_API_BASE_URL = "http://gateway.test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CIVITASONE_API_BASE_URL;
  });

  it("GAP-AUDIT-CAG-02: a valid but EMPTY array is an empty register, not an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, [])));
    const result = await getCagParas();
    expect(result.source).toBe("api");
    expect(result.data).toEqual([]);
  });

  it("GAP-AUDIT-CAG-01: does not fabricate per-row totalParas/settled/pending", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, [{ id: "p1", paraNo: "1", status: "settled" }])),
    );
    const result = await getCagParas();
    expect(result.source).toBe("api");
    expect(result.data).toHaveLength(1);
    const row = result.data[0];
    expect(row.totalParas).toBeUndefined();
    expect(row.settled).toBeUndefined();
    expect(row.pending).toBeUndefined();
    expect(row.status).toBe("settled");
  });

  it("GAP-AUDIT-CAG-04: a missing reportYear/department becomes null, never the raw sourceRef/deptRef", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, [{ id: "p1", paraNo: "1", status: "replied", sourceRef: "src-xyz", deptRef: "dept-abc" }]),
      ),
    );
    const result = await getCagParas();
    expect(result.source).toBe("api");
    expect(result.data[0].reportYear).toBeNull();
    expect(result.data[0].department).toBeNull();
    expect(result.data[0].status).toBe("partially_settled");
  });

  it("rows that ALL drop (no id) surface as an error, so a schema break is not hidden as 'empty'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, [{ paraNo: "1", status: "settled" }])));
    const result = await getCagParas();
    expect(result.source).toBe("error");
    expect(result.data).toEqual([]);
  });
});
