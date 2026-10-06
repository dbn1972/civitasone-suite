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

  it("GAP-PROJECTS-HOME-02: BOTH /api/v1/project and /api/v1/projects reach project-service's /v1/projects upstream (both canonical)", () => {
    // Singular prefix used by typed loaders (dashboard/projects/milestones/...).
    const singular = resolveRoute("/api/v1/project/projects/abc");
    expect(singular?.route.name).toBe("project");
    expect(singular?.route.upstream).toContain("3014");
    expect(singular?.route.upstreamPath).toBe("/v1/projects");
    expect(singular?.remainder).toBe("/projects/abc"); // -> upstream /v1/projects/projects/abc

    // Plural prefix used by sub-resources + mutations (members/tasks/milestones complete).
    const plural = resolveRoute("/api/v1/projects/abc/members");
    expect(plural?.route.name).toBe("projects");
    expect(plural?.route.upstream).toContain("3014");
    expect(plural?.route.upstreamPath).toBe("/v1/projects");
    expect(plural?.remainder).toBe("/abc/members"); // -> upstream /v1/projects/abc/members

    // Same upstream service for both — neither prefix is a dead end.
    expect(singular?.route.upstream).toBe(plural?.route.upstream);
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

  it("admin-operators route maps to identity-service /identity/operators (GAP-ADMIN-OPERATORS-05)", () => {
    const resolved = resolveRoute("/api/v1/admin/operators/requests");
    expect(resolved?.route.name).toBe("admin-operators");
    expect(resolved?.route.upstreamPath).toBe("/identity/operators");
    expect(resolved?.remainder).toBe("/requests");
    // the sibling admin-service routes are untouched
    expect(resolveRoute("/api/v1/admin/onboarding")?.route.name).toBe("admin");
  });

  it("maps /api/v1/notification/* to versioned upstream /v1/notification/*", () => {
    const resolved = resolveRoute("/api/v1/notification/experiments");
    expect(resolved?.route.name).toBe("notification-v1");
    expect(resolved?.route.upstreamPath).toBe("/v1/notification");
    expect(resolved?.remainder).toBe("/experiments");
  });
});
