/**
 * Org-chart role-gate tests (HRMS role-based review, Problem B).
 *
 * GET /v1/hrms/org-chart used to require hr_admin/hr_officer/super_admin/
 * manager, excluding "employee" even though hr/layout.tsx already admits
 * that role into the /hr/org-chart and /hr/orgchart pages that render this
 * exact data, and the response (see orgchart/queries.ts's OrgNode shape:
 * id/name/designation/department/reportsTo/children) carries no PII or
 * salary — ordinary reporting-line information every employee in a real
 * office needs to look up.
 *
 * Pattern: buildApp() + app.inject() + signToken(), matching
 * __tests__/department-routes.test.ts and this suite's sibling
 * employee-directory-role-gate.test.ts. scopedRead is mocked to an empty
 * result set — sufficient to distinguish 200 (authorized) from 403 (not).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0003-4000-8000-000000000033";

function tok(roles: string[], sub = "orgchart-test-user") {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-orgchart-test" }, SECRET);
}

vi.mock("../shared/db.js", () => {
  const sqlClientFn = (..._args: unknown[]) => Promise.resolve([]);
  sqlClientFn.end = vi.fn(async () => {});
  sqlClientFn.unsafe = vi.fn((..._args: unknown[]) => Promise.resolve([]));
  sqlClientFn.begin = vi.fn(async (fn: (tx: typeof sqlClientFn) => Promise<unknown>) => fn(sqlClientFn));
  return {
    db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
    sqlClient: sqlClientFn,
    scopedRead: async () => [],
  };
});

import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("GET /v1/hrms/org-chart — role gate", () => {
  it("200 — 'employee' now gets the org chart back (the fix)", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/org-chart",
      headers: { authorization: `Bearer ${tok(["employee"])}` },
    });
    expect(r.statusCode).toBe(200);
    expect(Array.isArray(r.json())).toBe(true);
  });

  it("200 — manager (pre-existing) is unaffected", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/org-chart",
      headers: { authorization: `Bearer ${tok(["manager"])}` },
    });
    expect(r.statusCode).toBe(200);
  });

  it("200 — hr_admin (pre-existing) is unaffected", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/org-chart",
      headers: { authorization: `Bearer ${tok(["hr_admin"])}` },
    });
    expect(r.statusCode).toBe(200);
  });

  it("401 — missing Authorization header is rejected", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/org-chart" });
    expect([401, 403]).toContain(r.statusCode);
  });

  it("403 — a role with no HR/ESS relationship at all is still rejected", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/org-chart",
      headers: { authorization: `Bearer ${tok(["citizen"])}` },
    });
    expect(r.statusCode).toBe(403);
  });
});
