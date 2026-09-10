/**
 * hrms-service — TX-014 regression test.
 *
 * `/v1/hrms/workforce/budget` and `/v1/hrms/workforce/diversity` used to
 * query `employee.position_budget` and `employee.employee_profiles`
 * directly — tables with no migration in any service (see
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md, TX-014). Every real call hit
 * PostgresError 42P01 ("relation ... does not exist"), surfaced by the
 * module's generic error handler as an opaque 500 `{ code: "INTERNAL" }`.
 *
 * Per TX-014's DoD, both endpoints now return an honest 501 stub
 * (`source: "stub"`, matching the recruitment/external-seams-routes.ts
 * convention) instead of a 500 — this asserts that contract holds, and
 * guards against a future edit reintroducing a raw query against the
 * still-nonexistent tables.
 */
import { describe, it, expect } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "0a1a5e00-4000-4000-8000-000000000802";
const ACTOR = "0a1a5e00-5000-4000-8000-000000000802";

function authHeader(roles = ["hr_officer", "super_admin"]) {
  const token = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-wfp-tx014" }, SECRET, 3600);
  return { authorization: `Bearer ${token}` };
}

describe("workforce-planning budget/diversity (TX-014)", () => {
  it("GET /v1/hrms/workforce/budget returns an honest 501 stub, never a 500", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/v1/hrms/workforce/budget",
        headers: authHeader(),
      });

      expect(res.statusCode).toBe(501);
      const body = res.json();
      expect(body.source).toBe("stub");
      expect(body.code).toBe("NOT_BUILT");
      expect(typeof body.message).toBe("string");
      expect(body.message.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("GET /v1/hrms/workforce/diversity returns an honest 501 stub, never a 500", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/v1/hrms/workforce/diversity",
        headers: authHeader(),
      });

      expect(res.statusCode).toBe(501);
      const body = res.json();
      expect(body.source).toBe("stub");
      expect(body.code).toBe("NOT_BUILT");
      expect(typeof body.message).toBe("string");
      expect(body.message.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("both stubs require an authenticated reader role (no accidental open route)", async () => {
    const app = await buildApp();
    try {
      const [budget, diversity] = await Promise.all([
        app.inject({ method: "GET", url: "/v1/hrms/workforce/budget" }),
        app.inject({ method: "GET", url: "/v1/hrms/workforce/diversity" }),
      ]);

      expect(budget.statusCode).not.toBe(200);
      expect(budget.statusCode).not.toBe(501);
      expect(diversity.statusCode).not.toBe(200);
      expect(diversity.statusCode).not.toBe(501);
    } finally {
      await app.close();
    }
  });
});
