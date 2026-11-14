/**
 * PATCH /v1/hrms/employees/:id/location and POST /v1/hrms/employees/location-assignments
 * (real Fastify app, real Postgres with RLS; only the outbound location-service call is mocked).
 *
 * UAT 11 Nov 2026 (Digital India Corporation): the generic employee update had no
 * locationId, so employees created before the head office existed could never be
 * assigned to it. These tests pin: set / change, same-tenant + active location only
 * (other tenant's id, unknown id, archived and an unreachable location-service are all
 * refused), HR-only, tenant isolation of the employee, the old -> new audit event, and
 * the bulk route's cap and partial-success behaviour.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

vi.mock("../shared/location-client.js", () => ({
  fetchLocationDescendantIds: vi.fn(async () => ({ ok: true, descendantIds: [] })),
  fetchLocation: vi.fn(),
}));
import { fetchLocation } from "../shared/location-client.js";
const fetchLocationMock = vi.mocked(fetchLocation);

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT   = "f0160000-0000-4000-8000-0000000000a1";
const OTHER_T  = "f0160000-0000-4000-8000-0000000000b1";
const HR_SUB   = "f0160000-0000-4000-8000-00000000a0a0";
const DEPT_ID  = "f0160000-0000-4000-8000-0000000000d1";
const DESIG_ID = "f0160000-0000-4000-8000-0000000000d2";
const ODEPT_ID = "f0160000-0000-4000-8000-0000000000d3";
const ODESIG   = "f0160000-0000-4000-8000-0000000000d4";

const EMP_A     = "f0160000-0000-4000-8000-0000000000e1";
const EMP_B     = "f0160000-0000-4000-8000-0000000000e2";
const EMP_C     = "f0160000-0000-4000-8000-0000000000e3";
const EMP_EXIT  = "f0160000-0000-4000-8000-0000000000e4";
const EMP_OTHER = "f0160000-0000-4000-8000-0000000000e5"; // in OTHER_T
const EMP_GONE  = "f0160000-0000-4000-8000-0000000000e9"; // never inserted

const HEAD_OFFICE   = "f0160000-0000-4000-8000-00000000c001"; // active, this tenant
const BRANCH        = "f0160000-0000-4000-8000-00000000c002"; // active, this tenant
const ARCHIVED_LOC  = "f0160000-0000-4000-8000-00000000c003";
const FOREIGN_LOC   = "f0160000-0000-4000-8000-00000000c004"; // belongs to another tenant -> 404 from location-service
const UNKNOWN_LOC   = "f0160000-0000-4000-8000-00000000c005";
const FLAKY_LOC     = "f0160000-0000-4000-8000-00000000c006"; // location-service unreachable

const hr = { authorization: `Bearer ${signToken({ sub: HR_SUB, tid: TENANT, roles: ["hr_admin"], sid: "s-loc" }, SECRET)}` };
const hrOfficer = { authorization: `Bearer ${signToken({ sub: HR_SUB, tid: TENANT, roles: ["hr_officer"], sid: "s-loco" }, SECRET)}` };
const employee = { authorization: `Bearer ${signToken({ sub: HR_SUB, tid: TENANT, roles: ["employee"], sid: "s-loce" }, SECRET)}` };
const manager = { authorization: `Bearer ${signToken({ sub: HR_SUB, tid: TENANT, roles: ["manager"], sid: "s-locm" }, SECRET)}` };

let app: Awaited<ReturnType<typeof buildApp>>;

function asTenant<T>(tid: string, fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, tid, fn);
}

async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER_T]) {
    await asTenant(t, (tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${t}`);
    await asTenant(t, (tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${t}`);
    await asTenant(t, (tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${t}`);
    await asTenant(t, (tx) => tx`DELETE FROM _outbox.messages WHERE tenant_id = ${t}`);
  }
}

async function seedEmployee(tid: string, id: string, no: string, dept: string, desig: string, status: string, locationId: string | null) {
  await asTenant(tid, (tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, status, location_id, created_by, updated_by)
    VALUES (${id}, ${tid}, ${no}, ${"Emp " + no}, ${dept}, ${desig}, '2022-01-01', ${status}, ${locationId}, ${HR_SUB}, ${HR_SUB})
  `);
}

async function locationOf(tid: string, id: string): Promise<string | null> {
  const rows = await asTenant(tid, (tx) => tx`SELECT location_id FROM employee.hrms_employees WHERE id = ${id}`);
  return (rows[0]?.location_id as string | null) ?? null;
}

async function auditEvents(tid: string, id: string): Promise<Array<Record<string, unknown>>> {
  const rows = await asTenant(tid, (tx) => tx`
    SELECT actor_id, payload FROM _outbox.messages
    WHERE tenant_id = ${tid} AND topic = 'audit.event.record' AND payload->>'action' = 'location_change' AND payload->>'resourceId' = ${id}
    ORDER BY created_at`);
  return rows.map((r) => ({ actor: r.actor_id, ...((typeof r.payload === "string" ? JSON.parse(r.payload as string) : r.payload) as Record<string, unknown>) }));
}

function setLocation(id: string, body: unknown, headers: Record<string, string> = hr) {
  return app.inject({ method: "PATCH", url: `/v1/hrms/employees/${id}/location`, headers, payload: body as Record<string, unknown> });
}
function bulk(body: unknown, headers: Record<string, string> = hr) {
  return app.inject({ method: "POST", url: "/v1/hrms/employees/location-assignments", headers, payload: body as Record<string, unknown> });
}

beforeAll(async () => {
  await cleanup();
  for (const [t, d, g] of [[TENANT, DEPT_ID, DESIG_ID], [OTHER_T, ODEPT_ID, ODESIG]] as const) {
    await asTenant(t, (tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${d}, ${t}, 'LOC', 'LOC Dept', ${HR_SUB}, ${HR_SUB})`);
    await asTenant(t, (tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${g}, ${t}, 'LOC', 'LOC Desig', ${HR_SUB}, ${HR_SUB})`);
  }
  await seedEmployee(TENANT, EMP_A, "LOCA", DEPT_ID, DESIG_ID, "confirmed", null);
  await seedEmployee(TENANT, EMP_B, "LOCB", DEPT_ID, DESIG_ID, "confirmed", BRANCH);
  await seedEmployee(TENANT, EMP_C, "LOCC", DEPT_ID, DESIG_ID, "probation", null);
  await seedEmployee(TENANT, EMP_EXIT, "LOCX", DEPT_ID, DESIG_ID, "separated", null);
  await seedEmployee(OTHER_T, EMP_OTHER, "LOCO", ODEPT_ID, ODESIG, "confirmed", null);
  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
});

beforeEach(() => {
  fetchLocationMock.mockReset();
  fetchLocationMock.mockImplementation(async (tenantId: string, locationId: string) => {
    if (tenantId !== TENANT) return { ok: false, reason: "not_found" };
    if (locationId === HEAD_OFFICE || locationId === BRANCH) return { ok: true, id: locationId, status: "active" };
    if (locationId === ARCHIVED_LOC) return { ok: true, id: locationId, status: "archived" };
    if (locationId === FLAKY_LOC) return { ok: false, reason: "unavailable" };
    return { ok: false, reason: "not_found" }; // FOREIGN_LOC, UNKNOWN_LOC
  });
});

describe("PATCH /v1/hrms/employees/:id/location", () => {
  it("sets a location on an employee that had none, and audits old (null) -> new with actor and reason", async () => {
    const res = await setLocation(EMP_A, { locationId: HEAD_OFFICE, reason: "head office now exists" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: EMP_A, locationId: HEAD_OFFICE, previousLocationId: null, changed: true });
    expect(fetchLocationMock).toHaveBeenCalledWith(TENANT, HEAD_OFFICE);
    expect(await locationOf(TENANT, EMP_A)).toBe(HEAD_OFFICE);

    const ev = await auditEvents(TENANT, EMP_A);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      actor: HR_SUB, service: "hrms", action: "location_change", resourceType: "employee", resourceId: EMP_A, outcome: "success",
      oldValue: { locationId: null }, newValue: { locationId: HEAD_OFFICE }, reason: "head office now exists",
    });
  });

  it("changes an existing location (old -> new in the audit event); hr_officer is allowed too", async () => {
    const res = await setLocation(EMP_B, { locationId: HEAD_OFFICE, reason: "transferred to HQ" }, hrOfficer);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ previousLocationId: BRANCH, locationId: HEAD_OFFICE, changed: true });
    expect(await locationOf(TENANT, EMP_B)).toBe(HEAD_OFFICE);
    const ev = await auditEvents(TENANT, EMP_B);
    expect(ev[0]).toMatchObject({ oldValue: { locationId: BRANCH }, newValue: { locationId: HEAD_OFFICE } });
  });

  it("is an idempotent no-op when the location is unchanged (no second audit event, no version bump)", async () => {
    const before = await asTenant(TENANT, (tx) => tx`SELECT version FROM employee.hrms_employees WHERE id = ${EMP_A}`);
    const res = await setLocation(EMP_A, { locationId: HEAD_OFFICE, reason: "retry" });
    expect(res.statusCode).toBe(200);
    expect(res.json().changed).toBe(false);
    expect(await auditEvents(TENANT, EMP_A)).toHaveLength(1);
    const after = await asTenant(TENANT, (tx) => tx`SELECT version FROM employee.hrms_employees WHERE id = ${EMP_A}`);
    expect(after[0]!.version).toBe(before[0]!.version);
  });

  it("refuses another tenant's location id (422 LOCATION_NOT_FOUND) and leaves the employee untouched", async () => {
    const res = await setLocation(EMP_C, { locationId: FOREIGN_LOC, reason: "wrong tenant id" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("LOCATION_NOT_FOUND");
    expect(await locationOf(TENANT, EMP_C)).toBeNull();
    expect(await auditEvents(TENANT, EMP_C)).toHaveLength(0);
  });

  it("refuses an unknown location id (422 LOCATION_NOT_FOUND)", async () => {
    const res = await setLocation(EMP_C, { locationId: UNKNOWN_LOC, reason: "no such office" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("LOCATION_NOT_FOUND");
    expect(await locationOf(TENANT, EMP_C)).toBeNull();
  });

  it("refuses an archived (inactive) location with 409 LOCATION_NOT_ACTIVE", async () => {
    const res = await setLocation(EMP_C, { locationId: ARCHIVED_LOC, reason: "closed office" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("LOCATION_NOT_ACTIVE");
    expect(await locationOf(TENANT, EMP_C)).toBeNull();
  });

  it("fails closed with 503 when location-service cannot be reached", async () => {
    const res = await setLocation(EMP_C, { locationId: FLAKY_LOC, reason: "location service down" });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("LOCATION_UNAVAILABLE");
    expect(await locationOf(TENANT, EMP_C)).toBeNull();
  });

  it("403 for roles that may not edit employment details (employee, manager); nothing is verified or written", async () => {
    for (const h of [employee, manager]) {
      const res = await setLocation(EMP_C, { locationId: HEAD_OFFICE, reason: "not allowed" }, h);
      expect(res.statusCode).toBe(403);
    }
    expect(fetchLocationMock).not.toHaveBeenCalled();
    expect(await locationOf(TENANT, EMP_C)).toBeNull();
  });

  it("404 for an employee of another tenant and for an unknown employee", async () => {
    expect((await setLocation(EMP_OTHER, { locationId: HEAD_OFFICE, reason: "cross tenant" })).statusCode).toBe(404);
    expect((await setLocation(EMP_GONE, { locationId: HEAD_OFFICE, reason: "no such employee" })).statusCode).toBe(404);
    expect(await locationOf(OTHER_T, EMP_OTHER)).toBeNull();
  });

  it("409 EMPLOYEE_EXITED for a separated employee", async () => {
    const res = await setLocation(EMP_EXIT, { locationId: HEAD_OFFICE, reason: "should be refused" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("EMPLOYEE_EXITED");
    expect(await locationOf(TENANT, EMP_EXIT)).toBeNull();
  });

  it("400 for a missing reason, a non-uuid locationId and unknown keys", async () => {
    expect((await setLocation(EMP_C, { locationId: HEAD_OFFICE })).statusCode).toBe(400);
    expect((await setLocation(EMP_C, { locationId: "not-a-uuid", reason: "bad id here" })).statusCode).toBe(400);
    expect((await setLocation(EMP_C, { locationId: HEAD_OFFICE, reason: "extra key", basicMinor: 1 })).statusCode).toBe(400);
  });
});

describe("POST /v1/hrms/employees/location-assignments (bulk)", () => {
  it("moves many, is partial-success safe (per-id outcomes, one audit event per change) and verifies the location once", async () => {
    // EMP_A is already at HEAD_OFFICE (unchanged); EMP_B is at HEAD_OFFICE too from the earlier test -> reset to BRANCH.
    await asTenant(TENANT, (tx) => tx`UPDATE employee.hrms_employees SET location_id = ${BRANCH} WHERE id = ${EMP_B}`);
    fetchLocationMock.mockClear();
    const res = await bulk({ locationId: HEAD_OFFICE, employeeIds: [EMP_A, EMP_B, EMP_C, EMP_EXIT, EMP_OTHER, EMP_GONE], reason: "bulk head-office assignment" });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(fetchLocationMock).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ locationId: HEAD_OFFICE, requested: 6, updated: 2, unchanged: 1, failed: 3 });
    const byId = Object.fromEntries(out.results.map((r: { id: string }) => [r.id, r]));
    expect(byId[EMP_A]).toMatchObject({ outcome: "unchanged", previousLocationId: HEAD_OFFICE });
    expect(byId[EMP_B]).toMatchObject({ outcome: "updated", previousLocationId: BRANCH });
    expect(byId[EMP_C]).toMatchObject({ outcome: "updated", previousLocationId: null });
    expect(byId[EMP_EXIT]).toMatchObject({ outcome: "failed", code: "EMPLOYEE_EXITED" });
    expect(byId[EMP_OTHER]).toMatchObject({ outcome: "failed", code: "NOT_FOUND" });
    expect(byId[EMP_GONE]).toMatchObject({ outcome: "failed", code: "NOT_FOUND" });
    // The failures did not roll back the successes.
    expect(await locationOf(TENANT, EMP_B)).toBe(HEAD_OFFICE);
    expect(await locationOf(TENANT, EMP_C)).toBe(HEAD_OFFICE);
    expect(await locationOf(TENANT, EMP_EXIT)).toBeNull();
    expect(await locationOf(OTHER_T, EMP_OTHER)).toBeNull();
    // Audit: one event per actual change, none for unchanged / failed.
    expect(await auditEvents(TENANT, EMP_C)).toHaveLength(1);
    expect(await auditEvents(TENANT, EMP_EXIT)).toHaveLength(0);
    expect(await auditEvents(OTHER_T, EMP_OTHER)).toHaveLength(0);
  });

  it("refuses the whole request when the location is another tenant's, unknown or archived", async () => {
    for (const [loc, status] of [[FOREIGN_LOC, 422], [UNKNOWN_LOC, 422], [ARCHIVED_LOC, 409]] as const) {
      const res = await bulk({ locationId: loc, employeeIds: [EMP_A], reason: "bad location" });
      expect(res.statusCode).toBe(status);
    }
  });

  it("caps the batch at 100 ids, rejects empty and duplicate lists", async () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `f0160000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
    expect((await bulk({ locationId: HEAD_OFFICE, employeeIds: ids(101), reason: "too many" })).statusCode).toBe(400);
    expect((await bulk({ locationId: HEAD_OFFICE, employeeIds: [], reason: "none at all" })).statusCode).toBe(400);
    expect((await bulk({ locationId: HEAD_OFFICE, employeeIds: [EMP_A, EMP_A], reason: "duplicates" })).statusCode).toBe(400);
    // exactly 100 is accepted (all unknown ids -> per-id NOT_FOUND, still a 200)
    const ok = await bulk({ locationId: HEAD_OFFICE, employeeIds: ids(100), reason: "exactly the cap" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ requested: 100, failed: 100 });
  });

  it("403 for non-HR roles", async () => {
    expect((await bulk({ locationId: HEAD_OFFICE, employeeIds: [EMP_A], reason: "not allowed" }, employee)).statusCode).toBe(403);
    expect((await bulk({ locationId: HEAD_OFFICE, employeeIds: [EMP_A], reason: "not allowed" }, manager)).statusCode).toBe(403);
  });
});
