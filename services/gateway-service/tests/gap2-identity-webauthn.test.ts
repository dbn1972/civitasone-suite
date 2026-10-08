/**
 * GAP2-IDENTITY-WEBAUTHN-01 — the "My passkeys" page loader and its Remove
 * action call /api/v1/identity/webauthn/credentials[/:id], but the registry
 * had only /api/identity (-> /identity). identity-service registers the
 * webauthn surface under /v1/identity/*, unreachable through /api/identity, so
 * every request 404'd (resolveRoute returned null). A new `identity-v1` prefix
 * forwards /api/v1/identity/* verbatim to the identity upstream /v1/identity/*.
 *
 * These assertions FAIL on the old registry: resolveRoute("/api/v1/identity/...")
 * returned null there.
 */
import { describe, it, expect } from "vitest";
import { resolveRoute, SERVICE_ROUTES } from "../src/registry.js";

function upstreamPathFor(pathname: string): string | null {
  const resolved = resolveRoute(pathname);
  if (!resolved) return null;
  const { route, remainder } = resolved;
  const basePath = route.upstreamPath ?? route.prefix.replace(/^\/api/, "");
  const rem = remainder === "/" ? "" : remainder;
  return `${basePath}${rem}`;
}

describe("GAP2-IDENTITY-WEBAUTHN-01: /api/v1/identity routes to identity-service", () => {
  it("registers an identity-v1 prefix on the identity upstream (port 3001)", () => {
    const route = SERVICE_ROUTES.find((r) => r.name === "identity-v1");
    expect(route).toBeDefined();
    expect(route?.prefix).toBe("/api/v1/identity");
    expect(route?.upstream).toContain("3001");
    expect(route?.upstreamPath).toBe("/v1/identity");
  });

  it("GET /api/v1/identity/webauthn/credentials resolves (not null/404) to /v1/identity/webauthn/credentials", () => {
    const resolved = resolveRoute("/api/v1/identity/webauthn/credentials");
    expect(resolved).not.toBeNull();
    expect(resolved?.route.name).toBe("identity-v1");
    expect(upstreamPathFor("/api/v1/identity/webauthn/credentials")).toBe(
      "/v1/identity/webauthn/credentials",
    );
  });

  it("DELETE path /api/v1/identity/webauthn/credentials/:id resolves to the identity upstream", () => {
    const resolved = resolveRoute("/api/v1/identity/webauthn/credentials/11111111-1111-4111-8111-111111111111");
    expect(resolved?.route.name).toBe("identity-v1");
    expect(upstreamPathFor("/api/v1/identity/webauthn/credentials/11111111-1111-4111-8111-111111111111")).toBe(
      "/v1/identity/webauthn/credentials/11111111-1111-4111-8111-111111111111",
    );
  });

  it("keeps the legacy /api/identity prefix distinct (-> /identity)", () => {
    const resolved = resolveRoute("/api/identity/users");
    expect(resolved?.route.name).toBe("identity");
    expect(upstreamPathFor("/api/identity/users")).toBe("/identity/users");
  });
});
