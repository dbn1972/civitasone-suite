/**
 * GAP-TENANT-ADMIN-HOME-06: pins how the tenant-admin dashboard reads the two
 * admin-service rollups it depends on (GET /v1/admin/health -> ok|degraded|down per
 * service; GET /v1/admin/health/readiness -> gate map derived from that rollup, or
 * {available:false} when the rollup cannot be produced).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Opts = { mapResponse: (p: unknown) => unknown };
const responses = vi.hoisted(() => ({ byPath: {} as Record<string, unknown> }));
vi.mock("./apiClient", () => ({
  fetchJson: vi.fn(async (path: string, empty: unknown, options: Opts) => {
    if (!(path in responses.byPath)) return { data: empty, source: "api" };
    const mapped = options.mapResponse(responses.byPath[path]);
    return mapped === null ? { data: empty, source: "error" } : { data: mapped, source: "api" };
  }),
}));

import { getTenantAdminDashboard, mapReadinessOrUnavailable, READINESS_UNAVAILABLE } from "./loaders";

const HEALTH = { status: "degraded", services: [{ service: "identity-service", status: "ok" }, { service: "admin-service", status: "down" }] };

describe("tenant-admin dashboard rollups", () => {
  beforeEach(() => { responses.byPath = { "/api/v1/admin/health": HEALTH }; });

  it("readiness {available:false} is a successful 'not available', not a failed load", async () => {
    responses.byPath["/api/v1/admin/health/readiness"] = { available: false, checkedAt: "2026-10-15T00:00:00.000Z" };
    const r = await getTenantAdminDashboard();
    expect(r.source).toBe("api");
    expect(r.data.readiness).toBeNull();
    expect(r.data.kpis.some((k) => k.label === "Readiness score")).toBe(false);
    expect(r.data.health).toEqual({ status: "degraded", services: HEALTH.services });
  });

  it("a real readiness body maps overall, gates and the production flag", async () => {
    responses.byPath["/api/v1/admin/health/readiness"] = {
      overall: 50, productionReady: false, allGreen: false,
      gates: { allServicesHealthy: false, platformResponsive: true, noServiceDown: false, serviceQuorum: true },
      scores: { serviceHealth: 50, availability: 50 }, checkedAt: "2026-10-15T00:00:00.000Z",
    };
    const r = await getTenantAdminDashboard();
    expect(r.source).toBe("api");
    expect(r.data.readiness).toMatchObject({ overall: 50, productionReady: false, allGreen: false });
    expect(r.data.readiness!.gates).toEqual([
      { key: "allServicesHealthy", passed: false }, { key: "platformResponsive", passed: true },
      { key: "noServiceDown", passed: false }, { key: "serviceQuorum", passed: true },
    ]);
    expect(r.data.kpis.find((k) => k.label === "Readiness score")?.value).toBe("50/100");
  });

  it("a malformed readiness body is still an error (not silently 'unavailable')", async () => {
    responses.byPath["/api/v1/admin/health/readiness"] = { surprise: true };
    expect((await getTenantAdminDashboard()).source).toBe("error");
  });

  it("mapReadinessOrUnavailable distinguishes the three shapes", () => {
    expect(mapReadinessOrUnavailable({ available: false })).toBe(READINESS_UNAVAILABLE);
    expect(mapReadinessOrUnavailable({ overall: 100, gates: {} })).toMatchObject({ overall: 100 });
    expect(mapReadinessOrUnavailable("nope")).toBeNull();
  });
});
