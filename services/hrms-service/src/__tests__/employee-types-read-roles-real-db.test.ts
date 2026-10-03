/**
 * GAP-HR-EMPLOYEE-TYPES-04 -- who may READ the employee-type master.
 * hr_officer and the payroll roles can (they run HR / payroll and need the
 * type flags); a plain employee cannot; writes stay HR-admin only.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "facade00-a90a-4000-8000-000000000a9a";
const as = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: randomUUID(), tid: TENANT, roles, sid: "sess-et-roles" }, SECRET)}` });

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

const list = (roles: string[]) => app.inject({ method: "GET", url: "/v1/hrms/employee-types", headers: as(roles) });

describe("GET /v1/hrms/employee-types read roles (GAP-HR-EMPLOYEE-TYPES-04)", () => {
  it.each(["hr_admin", "super_admin", "hr_officer", "manager", "payroll_admin", "payroll_officer"])("%s may read", async (role) => {
    expect((await list([role])).statusCode).toBe(200);
  });
  it.each(["employee", "finance_officer"])("%s may not (403)", async (role) => {
    expect((await list([role])).statusCode).toBe(403);
  });
  it("hr_officer and payroll roles still cannot WRITE the master", async () => {
    for (const role of ["hr_officer", "payroll_officer", "payroll_admin"]) {
      const r = await app.inject({ method: "POST", url: "/v1/hrms/employee-types", headers: as([role]), payload: { code: "X1", name: "X" } });
      expect(r.statusCode).toBe(403);
    }
  });
});
