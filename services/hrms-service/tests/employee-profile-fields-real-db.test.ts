/**
 * GAP-HR-EMPLOYEES-NEW-01 (profile fields persist, migration 0178) and
 * GAP-HR-EMPLOYEES-DETAIL-02 (a plain employee may open ONLY their own
 * record), real DB through the Fastify app.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { registerEmployeeConsumers } from "../src/modules/employee/consumer.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";

registerEmployeeConsumers(queue);
const drain = () => (queue as unknown as MemoryQueue).drain();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const HR = randomUUID();
const deptId = randomUUID();
const desigId = randomUUID();
const tok = (sub: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET)}`,
  "content-type": "application/json",
});
const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(fn));

let app: FastifyInstance;
const U = { alice: randomUUID(), bob: randomUUID(), mgr: randomUUID(), stranger: randomUUID() };
const E: Record<string, string> = {};

async function seed(name: string, userRef: string | null, managerId: string | null = null): Promise<string> {
  const id = randomUUID();
  await asTenant((tx) => tx.insert(hrmsEmployees).values({
    id, tenantId: TENANT, employeeNo: `PF-${id.slice(0, 8)}`, fullName: name, departmentId: deptId, designationId: desigId,
    dateOfJoining: "2024-01-01", status: "confirmed", employeeType: "permanent", basicMinor: 5_000_000n,
    userRef, managerId, createdBy: HR, updatedBy: HR,
  }));
  return id;
}

beforeAll(async () => {
  app = await buildApp();
  await asTenant(async (tx) => {
    await tx.insert(hrmsDepartments).values({ id: deptId, tenantId: TENANT, code: `P${TENANT.slice(0, 6)}`, name: "Dept", createdBy: HR, updatedBy: HR });
    await tx.insert(hrmsDesignations).values({ id: desigId, tenantId: TENANT, code: `PD${TENANT.slice(0, 6)}`, name: "Desig", createdBy: HR, updatedBy: HR });
  });
  E.mgr = await seed("Manager Person", U.mgr);
  E.alice = await seed("Alice", U.alice, E.mgr);
  E.bob = await seed("Bob", U.bob, E.mgr);
  E.other = await seed("Other Report", null, randomUUID());
});

afterAll(async () => {
  await asTenant(async (tx) => {
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
  });
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/employees/:id scope (GAP-HR-EMPLOYEES-DETAIL-02)", () => {
  const get = (id: string, sub: string, roles: string[]) => app.inject({ method: "GET", url: `/v1/hrms/employees/${id}`, headers: tok(sub, roles) });

  it("an employee opens their OWN record (masked PII shape unchanged)", async () => {
    const r = await get(E.alice!, U.alice, ["employee"]);
    expect(r.statusCode).toBe(200);
    expect((r.json() as { name: string }).name).toBe("Alice");
  });

  it("an employee cannot open a colleague's record, even one with the same manager", async () => {
    const r = await get(E.bob!, U.alice, ["employee"]);
    expect(r.statusCode).toBe(403);
    expect((r.json() as { message: string }).message).toMatch(/your own employee record/);
  });

  it("an employee who is only someone's manager-of-record does NOT get their reports without the manager role", async () => {
    expect((await get(E.alice!, U.mgr, ["employee"])).statusCode).toBe(403);
  });

  it("an employee with no resolvable employee link fails closed", async () => {
    expect((await get(E.alice!, U.stranger, ["employee"])).statusCode).toBe(403);
  });

  it("a manager still reads direct reports and their own record, not other people's", async () => {
    expect((await get(E.alice!, U.mgr, ["manager"])).statusCode).toBe(200);
    expect((await get(E.mgr!, U.mgr, ["manager"])).statusCode).toBe(200);
    expect((await get(E.other!, U.mgr, ["manager"])).statusCode).toBe(403);
  });

  it("HR is unrestricted (and a nonexistent id is a 404 for HR/managers); an employee-only caller cannot probe whether an id exists (403, not 404)", async () => {
    expect((await get(E.bob!, HR, ["hr_officer"])).statusCode).toBe(200);
    expect((await get(randomUUID(), HR, ["hr_officer"])).statusCode).toBe(404);
    expect((await get(randomUUID(), U.mgr, ["manager"])).statusCode).toBe(404);
    expect((await get(randomUUID(), U.alice, ["employee"])).statusCode).toBe(403);
  });

  it("roles outside the reader set stay refused", async () => {
    expect((await get(E.alice!, U.alice, ["vendor"])).statusCode).toBe(403);
  });
});

describe("profile fields persist (GAP-HR-EMPLOYEES-NEW-01, migration 0178)", () => {
  const body = (over: Record<string, unknown> = {}) => ({
    employeeNo: `NEW-${randomUUID().slice(0, 8)}`, fullName: "New Joiner", departmentId: deptId, designationId: desigId,
    dateOfJoining: "2026-01-05", serviceGrade: "Group-B", maritalStatus: "married", bloodGroup: "O+", shift: "morning",
    costCenterId: randomUUID(), locationId: randomUUID(), ...over,
  });

  it("create stores serviceGrade/maritalStatus/bloodGroup/shift/costCenterId and the detail API returns them", async () => {
    const payload = body();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/employees", headers: tok(HR, ["hr_admin"]), payload });
    expect(r.statusCode).toBe(202);
    const id = (r.json() as { id: string }).id;
    const row = (await asTenant((tx) => tx.select().from(hrmsEmployees).where(eq(hrmsEmployees.id, id))))[0]!;
    expect(row).toMatchObject({ serviceGrade: "Group-B", maritalStatus: "married", bloodGroup: "O+", shift: "morning", costCenterId: payload.costCenterId, locationId: payload.locationId });
    const d = (await app.inject({ method: "GET", url: `/v1/hrms/employees/${id}`, headers: tok(HR, ["hr_admin"]) })).json() as Record<string, unknown>;
    expect(d).toMatchObject({ serviceGrade: "Group-B", maritalStatus: "married", bloodGroup: "O+", shift: "morning", costCenterId: payload.costCenterId });
    // GAP-HR-LOCATIONS-03: the picked location-master id is stored on the employee (opaque ref)
    expect(row.locationId).toBe(payload.locationId);
  });

  it("an employee created without them has none (no phantom defaults)", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/hrms/employees", headers: tok(HR, ["hr_admin"]),
      payload: { employeeNo: `NEW-${randomUUID().slice(0, 8)}`, fullName: "Plain Joiner", departmentId: deptId, designationId: desigId, dateOfJoining: "2026-01-05" } });
    const id = (r.json() as { id: string }).id;
    const d = (await app.inject({ method: "GET", url: `/v1/hrms/employees/${id}`, headers: tok(HR, ["hr_admin"]) })).json() as Record<string, unknown>;
    for (const k of ["serviceGrade", "maritalStatus", "bloodGroup", "shift", "costCenterId"]) expect(d).not.toHaveProperty(k);
  });

  it("rejects values outside the closed sets at the boundary", async () => {
    for (const bad of [{ maritalStatus: "complicated" }, { bloodGroup: "Z+" }, { shift: "graveyard" }, { costCenterId: "not-a-uuid" }]) {
      const r = await app.inject({ method: "POST", url: "/v1/hrms/employees", headers: tok(HR, ["hr_admin"]), payload: body(bad) });
      expect(r.statusCode).toBe(400);
    }
  });

  it("PATCH updates the profile fields (async command) and the database CHECKs hold even against a direct write", async () => {
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/employees/${E.alice}`, headers: tok(HR, ["hr_admin"]), payload: { shift: "night", maritalStatus: "single", bloodGroup: "AB-", serviceGrade: "Group-A" } });
    expect(r.statusCode).toBe(202);
    await drain();
    const row = (await asTenant((tx) => tx.select().from(hrmsEmployees).where(eq(hrmsEmployees.id, E.alice!))))[0]!;
    expect(row).toMatchObject({ shift: "night", maritalStatus: "single", bloodGroup: "AB-", serviceGrade: "Group-A" });
    await expect(asTenant((tx) => tx.update(hrmsEmployees).set({ shift: "bogus" }).where(eq(hrmsEmployees.id, E.alice!)))).rejects.toThrow();
    await expect(asTenant((tx) => tx.update(hrmsEmployees).set({ bloodGroup: "ZZ" }).where(eq(hrmsEmployees.id, E.alice!)))).rejects.toThrow();
  });
});
