/**
 * FQ14 security review of PR #2379, findings 1-2 — the verified-email
 * auto-link in resolveEmployeeForActor (real Postgres + RLS + real app; only
 * identity-service is mocked).
 *
 * Before: the email fallback took rows[0] of every employee with the verified
 * email -- exited ones included, linked ones included -- and wrote user_ref
 * with no lock, so it could link a SEPARATED record, pick an arbitrary one of
 * two serving duplicates, steal a record already linked to another login, or
 * race HR's explicit link into two rows holding one login (which then locks
 * the login out with AMBIGUOUS_EMPLOYEE_LINK).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc, runWithTenant } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { resolveEmployeeForActor as resolveRaw } from "../modules/employee/actor-link.js";

// Called outside a request here, so establish the tenant context a request
// handler would have (scopedRead / db.transaction set app.tenant_id from it).
const resolveEmployeeForActor = (t: string, actor: string) => runWithTenant(t, () => resolveRaw(t, actor));

const { emails } = vi.hoisted(() => ({ emails: new Map<string, string>() }));
vi.mock("../shared/identity-client.js", () => ({
  fetchVerifiedActorEmail: vi.fn(async (_t: string, actorId: string) => emails.get(actorId)),
  fetchUserRoleKeys: vi.fn(async () => undefined),
  fetchUserStatus: vi.fn(async () => "active"),
}));

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "f0143000-0000-4000-8000-0000000000a1";
const SEED   = "f0143000-0000-4000-8000-0000000000ff";
const DEPT   = "f0143000-0000-4000-8000-0000000000d1";
const DESIG  = "f0143000-0000-4000-8000-0000000000d2";
const hr = { authorization: `Bearer ${signToken({ sub: SEED, tid: TENANT, roles: ["hr_admin"], sid: "s-fq14al" }, SECRET)}` };

let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>) => withRawTenantGuc(sqlClient, TENANT, fn);

async function emp(email: string, status = "confirmed", userRef: string | null = null): Promise<string> {
  const id = randomUUID();
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, status, email, user_ref, created_by, updated_by)
    VALUES (${id}, ${TENANT}, ${"AL-" + id.slice(0, 8)}, 'Autolink Test', ${DEPT}, ${DESIG}, '2022-01-01', ${status}, ${email}, ${userRef}, ${SEED}, ${SEED})`);
  return id;
}
async function holdersOf(login: string): Promise<string[]> {
  const rows = await asTenant((tx) => tx`SELECT id FROM employee.hrms_employees WHERE tenant_id = ${TENANT} AND user_ref = ${login} ORDER BY id`);
  return rows.map((r) => r.id as string);
}
async function refOf(id: string): Promise<string | null> {
  const rows = await asTenant((tx) => tx`SELECT user_ref FROM employee.hrms_employees WHERE id = ${id}`);
  return (rows[0]?.user_ref as string | null) ?? null;
}
function login(email: string): string {
  const l = randomUUID();
  emails.set(l, email);
  return l;
}
const uniqueEmail = () => `al-${randomUUID().slice(0, 8)}@example.gov.in`;

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT}, ${TENANT}, 'FQ14AL', 'FQ14AL', ${SEED}, ${SEED})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG}, ${TENANT}, 'FQ14AL', 'FQ14AL', ${SEED}, ${SEED})`);
  app = await buildApp();
});
afterAll(async () => {
  await cleanup();
  await app.close();
});
beforeEach(() => emails.clear());

describe("verified-email auto-link (FQ14 review findings 1-2)", () => {
  it("still bootstraps the single unambiguous match", async () => {
    const e = uniqueEmail();
    const id = await emp(e);
    const l = login(e);
    expect((await resolveEmployeeForActor(TENANT, l))?.id).toBe(id);
    expect(await holdersOf(l)).toEqual([id]);
  });

  it("two SERVING employees sharing the email: no link at all (fail closed)", async () => {
    const e = uniqueEmail();
    const a = await emp(e);
    const b = await emp(e, "probation");
    const l = login(e);
    expect(await resolveEmployeeForActor(TENANT, l)).toBeUndefined();
    expect(await refOf(a)).toBeNull();
    expect(await refOf(b)).toBeNull();
  });

  it("a SEPARATED and a CONFIRMED employee sharing the email: links the confirmed one only", async () => {
    const e = uniqueEmail();
    const separated = await emp(e, "separated");
    const confirmed = await emp(e, "confirmed");
    const l = login(e);
    expect((await resolveEmployeeForActor(TENANT, l))?.id).toBe(confirmed);
    expect(await refOf(separated)).toBeNull();
    expect(await holdersOf(l)).toEqual([confirmed]);
  });

  it("no_show / terminated / retired records never receive a login", async () => {
    const e = uniqueEmail();
    for (const st of ["no_show", "terminated", "retired"]) await emp(e, st);
    const l = login(e);
    expect(await resolveEmployeeForActor(TENANT, l)).toBeUndefined();
    expect(await holdersOf(l)).toEqual([]);
  });

  it("a login that already holds a record is not given a second one", async () => {
    const e = uniqueEmail();
    const l = login(e);
    const held = await emp(uniqueEmail(), "confirmed", l);
    const other = await emp(e);
    expect((await resolveEmployeeForActor(TENANT, l))?.id).toBe(held);
    expect(await refOf(other)).toBeNull();
  });

  it("a record already linked to a DIFFERENT login is never taken over", async () => {
    const e = uniqueEmail();
    const owner = randomUUID();
    const id = await emp(e, "confirmed", owner);
    const l = login(e);
    expect(await resolveEmployeeForActor(TENANT, l)).toBeUndefined();
    expect(await refOf(id)).toBe(owner);
  });

  it("auto-link racing HR's explicit link of the same login never leaves two rows holding it", async () => {
    for (let i = 0; i < 12; i++) {
      const e = uniqueEmail();
      const byEmail = await emp(e);        // what the auto-link would pick
      const byHr = await emp(uniqueEmail()); // what HR links explicitly
      const l = login(e);
      const [resolved, res] = await Promise.all([
        resolveEmployeeForActor(TENANT, l),
        app.inject({ method: "PATCH", url: `/v1/hrms/employees/${byHr}/login-link`, headers: hr, payload: { userId: l, reason: "race test link" } }),
      ]);
      const holders = await holdersOf(l);
      expect(holders).toHaveLength(1);
      if (res.statusCode === 200) {
        expect(holders).toEqual([byHr]);
      } else {
        expect(res.statusCode).toBe(409);
        expect(res.json().code).toBe("LOGIN_ALREADY_LINKED");
        expect(holders).toEqual([byEmail]);
      }
      if (resolved) expect(resolved.id).toBe(holders[0]);
      // And self-service keeps working: no AMBIGUOUS_EMPLOYEE_LINK lockout.
      expect((await resolveEmployeeForActor(TENANT, l))?.id).toBe(holders[0]);
    }
  });
});
