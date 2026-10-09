import { describe, it, expect } from "vitest";
import { resolveRoute } from "../src/registry.js";

/**
 * GAP2-PLATFORM-PROJECT-GATEWAY-01: project-service mounts board-intake under
 * the PLURAL path /v1/projects/board-intake (matching the gateway's
 * upstreamPath "/v1/projects"). Both the singular (/api/v1/project) and plural
 * (/api/v1/projects) client prefixes rewrite to that same upstream path + the
 * remainder, so the board-intake routes are reachable through the gateway
 * (previously the service mounted them under the SINGULAR /v1/project/... which
 * the gateway rewrote to a non-existent /v1/projects/board-intake → 404).
 */
describe("project-service board-intake gateway reachability", () => {
  it.each([
    "/api/v1/project/board-intake",
    "/api/v1/projects/board-intake",
    "/api/v1/project/board-intake/abc/accept",
    "/api/v1/projects/board-intake/abc/reject",
  ])("%s rewrites to a /v1/projects/board-intake upstream path", (path) => {
    const resolved = resolveRoute(path);
    expect(resolved).not.toBeNull();
    expect(resolved!.route.upstreamPath).toBe("/v1/projects");
    // The upstream target the gateway builds (upstreamPath + remainder) must be
    // the plural board-intake path the service now actually serves.
    const target = `${resolved!.route.upstreamPath}${resolved!.remainder}`;
    expect(target.startsWith("/v1/projects/board-intake")).toBe(true);
  });

  it("both project prefixes share one upstream", () => {
    expect(resolveRoute("/api/v1/project/x")!.route.upstream)
      .toBe(resolveRoute("/api/v1/projects/x")!.route.upstream);
  });
});
