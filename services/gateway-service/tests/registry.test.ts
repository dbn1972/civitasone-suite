import { describe, it, expect } from "vitest";
import { SERVICE_ROUTES, resolveRoute } from "../src/registry.js";

describe("gateway registry", () => {
  it("resolves hrms prefix", () => {
    const resolved = resolveRoute("/api/v1/hrms/employees");
    expect(resolved?.route.name).toBe("hrms");
    expect(resolved?.remainder).toBe("/employees");
  });

  it("maps project prefix to upstream projects path", () => {
    const resolved = resolveRoute("/api/v1/project/dashboard");
    expect(resolved?.route.upstreamPath).toBe("/v1/projects");
  });

  it("registers all core domain services", () => {
    const names = new Set(SERVICE_ROUTES.map((r) => r.name));
    for (const required of ["finance", "hrms", "procurement", "identity", "sync"]) {
      expect(names.has(required)).toBe(true);
    }
  });

  it("admin-users route maps to /identity/users (not /v1/identity/users)", () => {
    const resolved = resolveRoute("/api/v1/admin/users");
    expect(resolved?.route.name).toBe("admin-users");
    expect(resolved?.route.upstreamPath).toBe("/identity/users");
  });

  it("maps /api/v1/notification/* to versioned upstream /v1/notification/*", () => {
    const resolved = resolveRoute("/api/v1/notification/experiments");
    expect(resolved?.route.name).toBe("notification-v1");
    expect(resolved?.route.upstreamPath).toBe("/v1/notification");
    expect(resolved?.remainder).toBe("/experiments");
  });
});
