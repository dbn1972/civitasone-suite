import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Honest completion signals for the Bootstrap Wizard.
 * Covers GAP-SETUP-HOME-01 (departments uses the real departments endpoint)
 * and GAP-SETUP-HOME-03 (modules completes only on an explicit admin
 * confirmation flag, and an empty module list is "todo", not "unknown").
 */

type FetchJsonOpts = {
  mapResponse?: (p: unknown) => unknown;
};

// fetchJson is driven by a per-test router keyed on the request path.
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (path: string, fallback: unknown, opts: FetchJsonOpts) => fetchJsonMock(path, fallback, opts),
}));

// Loaders used by the other evaluators — stubbed so only the paths under test matter.
vi.mock("@/app/_data/loaders", () => ({
  getLocations: vi.fn(async () => ({ source: "api", data: [] })),
  getTenantUsers: vi.fn(async () => ({ source: "api", data: [] })),
  getChartOfAccounts: vi.fn(async () => ({ source: "api", data: [] })),
  getPayrollStructures: vi.fn(async () => ({ source: "api", data: [] })),
}));

import { evaluateStep } from "./progress";

/** Resolve a fetchJson call by applying its mapResponse to a canned payload. */
function routeFetch(routes: Record<string, { source?: "api" | "error"; payload: unknown }>) {
  fetchJsonMock.mockImplementation((path: string, fallback: unknown, opts: FetchJsonOpts) => {
    const p0 = typeof path === "string" ? path : "";
    const match = Object.keys(routes).find((p) => p0.includes(p));
    if (!match) return Promise.resolve({ source: "api", data: fallback });
    const { source = "api", payload } = routes[match];
    if (source === "error") return Promise.resolve({ source: "error", data: fallback });
    const mapped = opts && opts.mapResponse ? opts.mapResponse(payload) : payload;
    return Promise.resolve({ source: "api", data: mapped ?? fallback });
  });
}

beforeEach(() => fetchJsonMock.mockReset());

describe("evalDepartments (GAP-SETUP-HOME-01)", () => {
  it("reads the real departments endpoint, not the org chart", async () => {
    routeFetch({ "/api/v1/hrms/departments": { payload: [{ id: "d1" }] } });
    const status = await evaluateStep("departments");
    expect(status).toBe("complete");
    const calledPaths = fetchJsonMock.mock.calls.map((c) => c[0] as string);
    expect(calledPaths.some((p) => p.includes("/api/v1/hrms/departments"))).toBe(true);
    expect(calledPaths.some((p) => p.includes("/api/v1/hrms/org-chart"))).toBe(false);
  });

  it("is 'todo' when there are no departments", async () => {
    routeFetch({ "/api/v1/hrms/departments": { payload: [] } });
    expect(await evaluateStep("departments")).toBe("todo");
  });

  it("is 'unknown' when the departments list fails to load", async () => {
    routeFetch({ "/api/v1/hrms/departments": { source: "error", payload: null } });
    expect(await evaluateStep("departments")).toBe("unknown");
  });
});

describe("evalModules (GAP-SETUP-HOME-03)", () => {
  it("is 'todo' when modules exist but have not been confirmed (default seed)", async () => {
    routeFetch({ "/api/v1/tenants/current": { payload: { data: { settings: {} } } } });
    expect(await evaluateStep("modules")).toBe("todo");
  });

  it("is 'complete' only once the admin confirms their module selection", async () => {
    routeFetch({ "/api/v1/tenants/current": { payload: { data: { settings: { modulesConfirmedAt: "2026-01-01T00:00:00Z" } } } } });
    expect(await evaluateStep("modules")).toBe("complete");
  });

  it("accepts a boolean modulesConfirmed flag", async () => {
    routeFetch({ "/api/v1/tenants/current": { payload: { data: { settings: { modulesConfirmed: true } } } } });
    expect(await evaluateStep("modules")).toBe("complete");
  });

  it("is 'unknown' only on a load error", async () => {
    routeFetch({ "/api/v1/tenants/current": { source: "error", payload: null } });
    expect(await evaluateStep("modules")).toBe("unknown");
  });
});
