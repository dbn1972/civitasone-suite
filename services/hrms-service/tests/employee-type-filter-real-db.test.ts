/**
 * GAP-HR-INTERNS-03 (review D3): GET /v1/hrms/employees?employeeType=a,b matches
 * several engagement types, case-insensitively, against real Postgres.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { hrmsEmployees } from "../src/modules/employee/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
let app: FastifyInstance;
const headers = { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["hr_admin"], sid: "s-type-filter" }, SECRET, 3600)}` };

async function seed(employeeType: string): Promise<void> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsEmployees).values({
    id, tenantId: TENANT, employeeNo: `T-${id.slice(0, 8)}`, fullName: `Person ${employeeType}`,
    departmentId: randomUUID(), designationId: randomUUID(), dateOfJoining: "2024-01-15",
    employeeType, createdBy: ACTOR, updatedBy: ACTOR,
  }));
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  for (const t of ["Intern", "APPRENTICE", "internship", "apprenticeship", "permanent"]) await seed(t);
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

async function types(qs: string): Promise<string[]> {
  const res = await app.inject({ method: "GET", url: `/v1/hrms/employees?${qs}`, headers });
  expect(res.statusCode).toBe(200);
  return (res.json().data as Array<{ employeeType: string }>).map((e) => e.employeeType).sort();
}

describe("employees list employeeType filter", () => {
  it("multi-value, case-insensitive: returns every intern-ish type and not permanent", async () => {
    expect(await types("employeeType=intern,apprentice,internship,apprenticeship&limit=100"))
      .toEqual(["APPRENTICE", "Intern", "apprenticeship", "internship"]);
  });
  it("a single value still works (case-insensitively)", async () => {
    expect(await types("employeeType=INTERN&limit=100")).toEqual(["Intern"]);
  });
  it("rejects more than 8 values", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/employees?employeeType=a,b,c,d,e,f,g,h,i", headers });
    expect(res.statusCode).toBe(400);
  });
});
