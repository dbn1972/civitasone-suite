/**
 * Employee-directory role-gate tests (HRMS role-based review, Problem B).
 *
 * GET /v1/hrms/employees (the LIST route) backs hr/directory's Employee
 * Directory page. It used to require hr_admin/hr_officer/super_admin/
 * manager (READER_ROLES) -- excluding "employee" even though hr/layout.tsx
 * already admits that role into the page that renders this exact data, and
 * a company directory is ordinary, low-sensitivity lookup information.
 *
 * This suite proves two things together, because they're easy to get right
 * individually and wrong together:
 *  1. "employee" now gets real data back from the LIST route (the fix).
 *  2. "employee" still gets 403 from GET /v1/hrms/employees/:id (the detail
 *     route), which returns a much richer per-employee record (masked bank/
 *     PAN/phone) for an arbitrary id -- proving the fix was scoped to the
 *     directory list specifically and did NOT widen READER_ROLES itself.
 *
 * Pattern: buildApp() + app.inject() + signToken(), matching
 * __tests__/department-routes.test.ts. Only `scopedRead` is mocked (this
 * suite doesn't exercise writes), always resolving to an empty result set --
 * sufficient to distinguish 200 (authorized) from 403 (not), which is all
 * an authz-boundary test needs; the row-shaping logic itself is
 * queries.ts's own concern, not this file's.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0002-4000-8000-000000000022";

function tok(roles: string[], sub = "directory-test-user") {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-directory-test" }, SECRET);
}

vi.mock("../shared/db.js", () => {
  const sqlClientFn = (..._args: unknown[]) => Promise.resolve([]);
  sqlClientFn.end = vi.fn(async () => {});
  sqlClientFn.unsafe = vi.fn((..._args: unknown[]) => Promise.resolve([]));
  sqlClientFn.begin = vi.fn(async (fn: (tx: typeof sqlClientFn) => Promise<unknown>) => fn(sqlClientFn));
  return {
    db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
    sqlClient: sqlClientFn,
    // Always an empty result set -- enough to tell 200 (authorized) apart
    // from 403 (not); the actual row-joining logic is queries.ts's concern.
    scopedRead: async () => [],
  };
});

import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("GET /v1/hrms/employees — directory role gate", () => {
  it("200 — 'employee' now gets real data back (the fix)", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/employees?limit=50",
      headers: { authorization: `Bearer ${tok(["employee"])}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ data: unknown[] }>();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("200 — manager (pre-existing READER_ROLES member) is unaffected", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/employees?limit=50",
      headers: { authorization: `Bearer ${tok(["manager"])}` },
    });
    expect(r.statusCode).toBe(200);
  });

  it("200 — hr_admin (pre-existing) is unaffected", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/employees?limit=50",
      headers: { authorization: `Bearer ${tok(["hr_admin"])}` },
    });
    expect(r.statusCode).toBe(200);
  });

  it("403 — a role with no HR/ESS relationship at all is still rejected", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/employees?limit=50",
      headers: { authorization: `Bearer ${tok(["citizen"])}` },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe("GET /v1/hrms/employees/:id — detail route is NOT widened", () => {
  const EMP_ID = "00000000-1234-4000-8000-000000000001";

  it("403 — 'employee' is still denied the richer per-employee detail record (scope guard)", async () => {
    // This is the specific over-widening this fix must NOT introduce: if
    // DIRECTORY_ROLES had been used here (or READER_ROLES had been edited
    // directly), a plain employee could pull up ANY other employee's masked
    // bank/PAN/phone record by id. Confirms it still can't.
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${EMP_ID}`,
      headers: { authorization: `Bearer ${tok(["employee"])}` },
    });
    expect(r.statusCode).toBe(403);
  });

  it("manager still clears the role gate on the detail route, unchanged (locks in that READER_ROLES itself was left untouched)", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${EMP_ID}`,
      headers: { authorization: `Bearer ${tok(["manager"])}` },
    });
    // Not asserting 200 specifically: scopedRead is mocked to an empty
    // result set, so the route's own "employee not found" 404 fires after
    // the auth check passes. What this test guards is the auth layer only —
    // manager must not be turned away with a 403, which is all READER_ROLES
    // (deliberately left untouched by this fix) is responsible for.
    expect(r.statusCode).not.toBe(403);
  });
});
