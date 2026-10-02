import { describe, it, expect } from "vitest";
import { resolveRoute } from "../src/registry.js";

// GAP-ASSETS-INSURANCE-02: the web calls asset-service through BOTH
// /api/v1/asset/... (register, dashboard, detail, depreciation loaders) and
// /api/v1/assets/... (insurance, fleet). Pin that both prefixes reach the
// same asset-service upstream with the same upstream path, so neither set of
// pages can silently 404 into an empty list.
describe("asset-service gateway prefixes", () => {
  it.each([
    ["/api/v1/asset/assets", "/assets"],
    ["/api/v1/assets/assets", "/assets"],
    ["/api/v1/assets/insurance/policies", "/insurance/policies"],
    ["/api/v1/asset/insurance/policies", "/insurance/policies"],
    ["/api/v1/assets/fleet/vehicles", "/fleet/vehicles"],
  ])("%s reaches asset-service at /v1/assets%s", (path, remainder) => {
    const resolved = resolveRoute(path);
    expect(resolved).not.toBeNull();
    expect(resolved!.route.upstreamPath).toBe("/v1/assets");
    expect(resolved!.remainder).toBe(remainder);
  });

  it("both prefixes share one upstream", () => {
    expect(resolveRoute("/api/v1/asset/x")!.route.upstream).toBe(resolveRoute("/api/v1/assets/x")!.route.upstream);
  });
});
