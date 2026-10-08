/**
 * GAP2-TENANT-WIRING-01 — the eight tenant sub-page web loaders call
 * /api/v1/tenant/<x> paths. The gateway `tenant-singular` prefix (/api/v1/tenant)
 * forwards them verbatim to tenant-service as /v1/tenant/<x>. These assertions
 * prove the gateway routes each of the 8 loader URLs to the tenant upstream and
 * that the forwarded upstream path keeps the `tenant/` segment (so the newly
 * added tenant-service aliases receive them). The sibling `/api/v1/tenants`
 * (plural) prefix must stay distinct for the /v1/tenants/* canonical routes.
 */
import { describe, it, expect } from "vitest";
import { resolveRoute, SERVICE_ROUTES } from "../src/registry.js";

// Mirrors the gateway's forwarding: basePath = upstreamPath ?? prefix without /api.
function upstreamPathFor(pathname: string): string | null {
  const resolved = resolveRoute(pathname);
  if (!resolved) return null;
  const { route, remainder } = resolved;
  const basePath = route.upstreamPath ?? route.prefix.replace(/^\/api/, "");
  const rem = remainder === "/" ? "" : remainder;
  return `${basePath}${rem}`;
}

const LOADER_PATHS: Array<{ web: string; upstream: string }> = [
  { web: "/api/v1/tenant/current", upstream: "/v1/tenant/current" },
  { web: "/api/v1/tenant/settings", upstream: "/v1/tenant/settings" },
  { web: "/api/v1/tenant/org/hierarchy", upstream: "/v1/tenant/org/hierarchy" },
  { web: "/api/v1/tenant/code-lists", upstream: "/v1/tenant/code-lists" },
  { web: "/api/v1/tenant/positions", upstream: "/v1/tenant/positions" },
  { web: "/api/v1/tenant/consent/requests", upstream: "/v1/tenant/consent/requests" },
  { web: "/api/v1/tenant/data-governance/domains", upstream: "/v1/tenant/data-governance/domains" },
  { web: "/api/v1/tenant/org/migrations", upstream: "/v1/tenant/org/migrations" },
];

describe("GAP2-TENANT-WIRING-01: tenant sub-page loader paths route to tenant-service", () => {
  it("the tenant-singular prefix exists and targets tenant-service (port 3002)", () => {
    const singular = SERVICE_ROUTES.find((r) => r.name === "tenant-singular");
    expect(singular).toBeDefined();
    expect(singular?.prefix).toBe("/api/v1/tenant");
    expect(singular?.upstream).toContain("3002");
  });

  for (const { web, upstream } of LOADER_PATHS) {
    it(`resolves ${web} -> tenant upstream ${upstream} (not 404)`, () => {
      const resolved = resolveRoute(web);
      expect(resolved, `no route resolved for ${web}`).not.toBeNull();
      expect(resolved?.route.name).toBe("tenant-singular");
      expect(resolved?.route.upstream).toContain("3002");
      expect(upstreamPathFor(web)).toBe(upstream);
    });
  }

  it("keeps the plural /api/v1/tenants/current distinct (canonical tenant read)", () => {
    const resolved = resolveRoute("/api/v1/tenants/current");
    expect(resolved?.route.name).toBe("tenant");
    expect(upstreamPathFor("/api/v1/tenants/current")).toBe("/v1/tenants/current");
  });
});
