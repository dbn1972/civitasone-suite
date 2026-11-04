/**
 * UX-R5 (names, not ids): GET /v1/hrms/employees/officers?ids= -- "Name, Designation" for the maker / checker /
 * officer ids record screens hold. Each id may be an employee id or a login user ref (JWT sub). Real DB through
 * the Fastify app. Pins: both key kinds resolve, only {id, name, designation} cross the boundary, another
 * tenant employee never resolves, bad input is a 400, an unauthenticated caller is a 401.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import { officerEntriesFor } from "../src/modules/employee/queries.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TA = randomUUID();
const TB = randomUUID();
const ACTOR = randomUUID();
const dept = { [TA]: randomUUID(), [TB]: randomUUID() };
const desig = { [TA]: randomUUID(), [TB]: randomUUID() };
const SUB_A = randomUUID();
const SUB_B = randomUUID();
let EMP_A = "";
let EMP_B = "";

const asTenant = <T>(t: string, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) => runWithTenant(t, () => db.transaction(fn));
const h = (tid = TA, roles = ["employee"]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "s" }, SECRET)}` });
let app: FastifyInstance;

async function seedTenant(t: string, name: string, desigName: string, userRef: string): Promise<string> {
  const id = randomUUID();
  await asTenant(t, async (tx) => {
    await tx.insert(hrmsDepartments).values({ id: dept[t]!, tenantId: t, code: `O${t.slice(0, 6)}`, name: "Accounts", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(hrmsDesignations).values({ id: desig[t]!, tenantId: t, code: `OD${t.slice(0, 6)}`, name: desigName, createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(hrmsEmployees).values({
      id, tenantId: t, employeeNo: `OF-${id.slice(0, 8)}`, fullName: name, departmentId: dept[t]!, designationId: desig[t]!,
      dateOfJoining: "2024-01-01", status: "confirmed", employeeType: "permanent", basicMinor: 5_000_000n, userRef, createdBy: ACTOR, updatedBy: ACTOR,
    });
  });
  return id;
}

beforeAll(async () => {
  app = await buildApp();
  EMP_A = await seedTenant(TA, "Asha Rao", "Section Officer", SUB_A);
  EMP_B = await seedTenant(TB, "Chandra Nair", "Under Secretary", SUB_B);
});

afterAll(async () => {
  for (const t of [TA, TB]) {
    await asTenant(t, async (tx) => {
      await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, t));
      await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, t));
      await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, t));
    });
  }
  await app.close();
  await sqlClient.end();
});

const get = (qs: string, headers: Record<string, string> = h()) => app.inject({ method: "GET", url: `/v1/hrms/employees/officers?${qs}`, headers });

describe("GET /v1/hrms/employees/officers", () => {
  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/hrms/employees/officers?ids=${SUB_A}` });
    expect(res.statusCode).toBe(401);
  });

  it("resolves an employee id and a login user ref to Name + Designation, under the id asked", async () => {
    const res = await get(`ids=${EMP_A},${SUB_A}`);
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<Record<string, unknown>>;
    expect(rows).toEqual(expect.arrayContaining([
      { id: EMP_A, name: "Asha Rao", designation: "Section Officer" },
      { id: SUB_A, name: "Asha Rao", designation: "Section Officer" },
    ]));
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(["designation", "id", "name"]);
  });

  it("never resolves another tenant employee, by employee id or by user ref", async () => {
    const res = await get(`ids=${EMP_B},${SUB_B}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("400 for a non-UUID id or more than 100 ids", async () => {
    expect((await get("ids=not-a-uuid")).statusCode).toBe(400);
    const many = Array.from({ length: 101 }, () => randomUUID()).join(",");
    expect((await get(`ids=${many}`)).statusCode).toBe(400);
  });
});

describe("officerEntriesFor (pure keying)", () => {
  it("an employee-id match wins over a user-ref match for the same asked id", () => {
    const k = randomUUID();
    const out = officerEntriesFor([k], [
      { id: randomUUID(), userRef: k, fullName: "By ref", designationId: "d" },
      { id: k, userRef: null, fullName: "By id", designationId: "d" },
    ], new Map([["d", "SO"]]));
    expect(out).toEqual([{ id: k, name: "By id", designation: "SO" }]);
  });
});
