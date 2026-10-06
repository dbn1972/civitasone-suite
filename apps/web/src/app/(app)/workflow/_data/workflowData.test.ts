import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Override the global next/headers mock so a Bearer token is present (the
// data layer short-circuits to 401 without one, before any fetch).
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: vi.fn(() => ({ value: "test.jwt.token" })),
    set: vi.fn(),
    delete: vi.fn(),
  }),
  headers: () => new Map(),
}));

import {
  getDefinitionById,
  getInstanceById,
  getInstanceHistory,
  getTasksForInstance,
} from "./workflowData";

const VALID = "11111111-2222-4333-8444-555555555555";

describe("workflowData id validation (GAP-WORKFLOW-DEFINITIONS-DETAIL-03 / INSTANCES-DETAIL-06)", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    process.env.CIVITASONE_API_BASE_URL = "https://gw.example.test";
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CIVITASONE_API_BASE_URL;
  });

  it.each([
    ["../admin", getDefinitionById],
    ["a/b", getDefinitionById],
    ["x%2F..%2Fv1%2Fother", getInstanceById],
    ["not-a-uuid", getInstanceHistory],
    ["'; DROP TABLE", getTasksForInstance],
  ] as const)("never fetches and returns 404 for invalid id %s", async (badId, fn) => {
    const res = await fn(badId);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.source).toBe("error");
    expect(res.status).toBe(404);
  });

  it("fetches the encoded path for a valid uuid", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { id: VALID, code: "c", name: "n", version: 1, status: "active", nodes: [], edges: [] } }),
    });
    const res = await getDefinitionById(VALID);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toBe(`https://gw.example.test/api/v1/workflow/definitions/${VALID}`);
    expect(res.source).toBe("api");
  });
});
