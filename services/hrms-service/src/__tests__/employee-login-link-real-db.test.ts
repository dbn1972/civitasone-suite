/**
 * FQ14 — PATCH /v1/hrms/employees/:id/login-link (real Fastify app, real
 * Postgres with RLS; only the outbound identity-service call is mocked).
 *
 * Before this route, nothing could set hrms_employees.user_ref for a real
 * login (the email fallback in actor-link.ts could not resolve a Keycloak
 * sub), so no user could reach their own employee record through
 * self-service. These tests pin: link, unlink, one serving employee per login
 * (409), HR-only (403), tenant isolation (404), the audit outbox event, and
 * that the link actually makes self-service resolve the caller.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { resolveEmployeeForActor } from "../modules/employee/actor-link.js";

vi.mock("../shared/identity-client.js", () => ({
  fetchVerifiedActorEmail: vi.fn(async () => undefined),
  fetchUserRoleKeys: vi.fn(async () => undefined),
  fetchUserStatus: vi.fn(),
}));
import { fetchUserStatus } from "../shared/identity-client.js";
const fetchUserStatusMock = vi.mocked(fetchUserStatus);

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT   = "f0140000-0000-4000-8000-0000000000a1";
const OTHER_T  = "f0140000-0000-4000-8000-0000000000b1";
const HR_SUB   = "f0140000-0000-4000-8000-00000000a0a0";
const DEPT_ID  = "f0140000-0000-4000-8000-0000000000d1";
const DESIG_ID = "f0140000-0000-4000-8000-0000000000d2";
const ODEPT_ID = "f0140000-0000-4000-8000-0000000000d3";
const ODESIG   = "f0140000-0000-4000-8000-0000000000d4";

const EMP_A     = "f0140000-0000-4000-8000-0000000000e1";
const EMP_B     = "f0140000-0000-4000-8000-0000000000e2";
const EMP_EXIT  = "f0140000-0000-4000-8000-0000000000e3";
const EMP_OTHER = "f0140000-0000-4000-8000-0000000000e4"; // in OTHER_T

const LOGIN_1 = "f0140000-0000-4000-8000-00000000c001"; // a Keycloak sub
const LOGIN_2 = "f0140000-0000-4000-8000-00000000c002";

const hr = { authorization: `Bearer ${signToken({ sub: HR_SUB, tid: TENANT, roles: ["hr_admin"], sid: "s-fq14" }, SECRET)}` };
const employee = { authorization: `Bearer ${signToken({ sub: LOGIN_2, tid: TENANT, roles: ["employee"], sid: "s-fq14e" }, SECRET)}` };

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

async function seedEmployee(tid: string, id: string, no: string, dept: string, desig: string, status: string, userRef: string | null) {
  await asTenant(tid, (tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, status, user_ref, created_by, updated_by)
    VALUES (${id}, ${tid}, ${no}, ${"Emp " + no}, ${dept}, ${desig}, '2022-01-01', ${status}, ${userRef}, ${HR_SUB}, ${HR_SUB})
  `);
}

async function userRefOf(tid: string, id: string): Promise<string | null> {
  const rows = await asTenant(tid, (tx) => tx`SELECT user_ref FROM employee.hrms_employees WHERE id = ${id}`);
  return (rows[0]?.user_ref as string | null) ?? null;
}

function link(id: string, body: unknown, headers: Record<string, string> = hr) {
  return app.inject({ method: "PATCH", url: `/v1/hrms/employees/${id}/login-link`, headers, payload: body as Record<string, unknown> });
}

beforeAll(async () => {
  await cleanup();
  for (const [t, d, g] of [[TENANT, DEPT_ID, DESIG_ID], [OTHER_T, ODEPT_ID, ODESIG]] as const) {
    await asTenant(t, (tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${d}, ${t}, 'FQ14', 'FQ14 Dept', ${HR_SUB}, ${HR_SUB})`);
    await asTenant(t, (tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${g}, ${t}, 'FQ14', 'FQ14 Desig', ${HR_SUB}, ${HR_SUB})`);
  }
  await seedEmployee(TENANT, EMP_A, "FQ14A", DEPT_ID, DESIG_ID, "confirmed", null);
  await seedEmployee(TENANT, EMP_B, "FQ14B", DEPT_ID, DESIG_ID, "confirmed", null);
  await seedEmployee(TENANT, EMP_EXIT, "FQ14X", DEPT_ID, DESIG_ID, "separated", null);
  await seedEmployee(OTHER_T, EMP_OTHER, "FQ14O", ODEPT_ID, ODESIG, "confirmed", null);
  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
});

beforeEach(() => {
  fetchUserStatusMock.mockReset();
  fetchUserStatusMock.mockResolvedValue("active");
});

describe("PATCH /v1/hrms/employees/:id/login-link (FQ14)", () => {
  it("links a login, emits an audit event with before/after, actor and reason, and self-service then resolves it", async () => {
    expect(await resolveEmployeeForActor(TENANT, LOGIN_1)).toBeUndefined();

    const res = await link(EMP_A, { userId: LOGIN_1, reason: "first login for UXT persona" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: EMP_A, userRef: LOGIN_1, previousUserRef: null, changed: true });
    expect(fetchUserStatusMock).toHaveBeenCalledWith(TENANT, LOGIN_1);
    expect(await userRefOf(TENANT, EMP_A)).toBe(LOGIN_1);
    expect((await resolveEmployeeForActor(TENANT, LOGIN_1))?.id).toBe(EMP_A);

    const ev = await asTenant(TENANT, (tx) => tx`
      SELECT actor_id, payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record' AND payload->>'resourceId' = ${EMP_A}
      ORDER BY created_at DESC LIMIT 1`);
    expect(ev).toHaveLength(1);
    const payload = (typeof ev[0]!.payload === "string" ? JSON.parse(ev[0]!.payload as string) : ev[0]!.payload) as Record<string, unknown>;
    expect(ev[0]!.actor_id).toBe(HR_SUB);
    expect(payload).toMatchObject({
      service: "hrms", action: "login_link", resourceType: "employee", resourceId: EMP_A,
      oldValue: { userRef: null }, newValue: { userRef: LOGIN_1 }, reason: "first login for UXT persona",
    });
  });

  it("409 LOGIN_ALREADY_LINKED when another serving employee already holds the login", async () => {
    const res = await link(EMP_B, { userId: LOGIN_1, reason: "duplicate attempt" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("LOGIN_ALREADY_LINKED");
    expect(await userRefOf(TENANT, EMP_B)).toBeNull();
  });

  it("re-linking the same login to the same employee is an idempotent no-op (no second audit event)", async () => {
    const before = await asTenant(TENANT, (tx) => tx`SELECT count(*)::int AS n FROM _outbox.messages WHERE tenant_id = ${TENANT} AND payload->>'resourceId' = ${EMP_A}`);
    const res = await link(EMP_A, { userId: LOGIN_1, reason: "retry" });
    expect(res.statusCode).toBe(200);
    expect(res.json().changed).toBe(false);
    const after = await asTenant(TENANT, (tx) => tx`SELECT count(*)::int AS n FROM _outbox.messages WHERE tenant_id = ${TENANT} AND payload->>'resourceId' = ${EMP_A}`);
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  it("unlinks (userId null) with an audited before/after", async () => {
    const res = await link(EMP_A, { userId: null, reason: "wrong person linked" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: EMP_A, userRef: null, previousUserRef: LOGIN_1, changed: true });
    expect(await userRefOf(TENANT, EMP_A)).toBeNull();
    expect(fetchUserStatusMock).not.toHaveBeenCalled();
    const ev = await asTenant(TENANT, (tx) => tx`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND payload->>'action' = 'login_unlink' AND payload->>'resourceId' = ${EMP_A}`);
    expect(ev).toHaveLength(1);
    const payload = (typeof ev[0]!.payload === "string" ? JSON.parse(ev[0]!.payload as string) : ev[0]!.payload) as Record<string, unknown>;
    expect(payload).toMatchObject({ oldValue: { userRef: LOGIN_1 }, newValue: { userRef: null }, reason: "wrong person linked" });

    // Now free: the login can be linked to EMP_B.
    const relink = await link(EMP_B, { userId: LOGIN_1, reason: "correct person" });
    expect(relink.statusCode).toBe(200);
    expect(await userRefOf(TENANT, EMP_B)).toBe(LOGIN_1);
  });

  it("an exited employee holding the login does not block a link, and cannot itself be linked", async () => {
    await asTenant(TENANT, (tx) => tx`UPDATE employee.hrms_employees SET user_ref = ${LOGIN_2} WHERE id = ${EMP_EXIT}`);
    const ok = await link(EMP_A, { userId: LOGIN_2, reason: "rejoined under new record" });
    expect(ok.statusCode).toBe(200);
    expect(await userRefOf(TENANT, EMP_A)).toBe(LOGIN_2);

    const refused = await link(EMP_EXIT, { userId: LOGIN_1, reason: "should not link" });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe("EMPLOYEE_EXITED");
  });

  it("403 for a non-HR caller, and nothing changes", async () => {
    const res = await link(EMP_B, { userId: LOGIN_2, reason: "self-link attempt" }, employee);
    expect(res.statusCode).toBe(403);
    expect(await userRefOf(TENANT, EMP_B)).toBe(LOGIN_1);
  });

  it("404 for an employee in another tenant, and that row is untouched", async () => {
    const res = await link(EMP_OTHER, { userId: LOGIN_2, reason: "cross-tenant attempt" });
    expect(res.statusCode).toBe(404);
    expect(await userRefOf(OTHER_T, EMP_OTHER)).toBeNull();
  });

  it("refuses a login identity-service does not know (422), a non-active one (409), and fails closed when identity is unreachable (503)", async () => {
    fetchUserStatusMock.mockResolvedValueOnce(null);
    expect((await link(EMP_B, { userId: LOGIN_2, reason: "unknown login" })).json().code).toBe("LOGIN_NOT_FOUND");
    fetchUserStatusMock.mockResolvedValueOnce("deactivated");
    expect((await link(EMP_B, { userId: LOGIN_2, reason: "inactive login" })).statusCode).toBe(409);
    fetchUserStatusMock.mockResolvedValueOnce(undefined);
    expect((await link(EMP_B, { userId: LOGIN_2, reason: "identity down" })).statusCode).toBe(503);
    expect(await userRefOf(TENANT, EMP_B)).toBe(LOGIN_1);
  });

  it("400 for a missing/short reason or a non-uuid userId", async () => {
    expect((await link(EMP_B, { userId: LOGIN_2 })).statusCode).toBe(400);
    expect((await link(EMP_B, { userId: LOGIN_2, reason: "x" })).statusCode).toBe(400);
    expect((await link(EMP_B, { userId: "not-a-uuid", reason: "valid reason" })).statusCode).toBe(400);
  });
});
