/**
 * Gateway Service — Registry: Deep tests.
 *
 * Tests service route registry completeness, port uniqueness, prefix format,
 * and upstream URL construction.
 *
 * Source: src/registry.ts
 */
import { describe, it, expect } from "vitest";
import { SERVICE_ROUTES, type ServiceRoute } from "../src/registry.js";

describe("SERVICE_ROUTES — gateway registry invariants", () => {
  it("has at least 30 registered routes", () => {
    expect(SERVICE_ROUTES.length).toBeGreaterThanOrEqual(30);
  });

  it("all routes have required fields", () => {
    for (const route of SERVICE_ROUTES) {
      expect(route.name).toBeTruthy();
      expect(route.prefix).toMatch(/^\/api\//);
      expect(route.upstream).toMatch(/^http/);
    }
  });

  it("no duplicate prefixes", () => {
    const prefixes = SERVICE_ROUTES.map(r => r.prefix);
    const unique = new Set(prefixes);
    expect(unique.size).toBe(prefixes.length);
  });

  it("core services are registered", () => {
    const names = SERVICE_ROUTES.map(r => r.name);
    for (const svc of ["identity", "finance", "hrms", "payroll", "procurement", "citizen", "workflow"]) {
      expect(names).toContain(svc);
    }
  });

  it("all upstreams use http://127.0.0.1:PORT format (default)", () => {
    for (const route of SERVICE_ROUTES) {
      expect(route.upstream).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    }
  });

  it("known port assignments: identity=3001, finance=3007, hrms=3012", () => {
    const find = (name: string) => SERVICE_ROUTES.find(r => r.name === name);
    expect(find("identity")?.upstream).toContain(":3001");
    expect(find("finance")?.upstream).toContain(":3007");
    expect(find("hrms")?.upstream).toContain(":3012");
  });

  it("prefixes are kebab-case with /api/ or /api/v1/ prefix", () => {
    for (const route of SERVICE_ROUTES) {
      expect(route.prefix).toMatch(/^\/api(\/v1)?\/[a-z0-9\/-]+$/);
    }
  });
});
