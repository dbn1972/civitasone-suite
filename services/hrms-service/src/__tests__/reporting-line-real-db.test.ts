/**
 * Internal reporting-line lookup (delegation notifications to the delegator's manager).
 * Real DB, FORCE RLS, real route. Proves: manager resolved to the manager's login actor id,
 * "no manager" and "unlinked actor" both fail soft (200, manager null), a separated or
 * login-less manager is not returned, cross-tenant isolation, and the internal gate.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

process.env.INTERNAL_SERVICE_SECRET = globalThis.crypto.randomUUID();

const TENANT = "beef0000-0000-4000-8000-0000000d1e01";
const OTHER = "beef0000-0000-4000-8000-0000000d1e02";
const ACTOR = "beef0000-0000-4000-8000-0000000d1ea0";
const DEPT_OF = (t: string) => (t === TENANT ? "beef0000-0000-4000-8000-0000000d1eda" : "beef0000-0000-4000-8000-0000000d1edb");
const DESIG_OF = (t: string) => (t === TENANT ? "beef0000-0000-4000-8000-0000000d1ed1" : "beef0000-0000-4000-8000-0000000d1ed2");
const e = (n: number) => `beef0000-0000-4000-9d1e-${String(n).padStart(12, "0")}`;
const login = (n: number) => `beef0000-0000-4000-ad1e-${String(n).padStart(12, "0")}`;
// 1 = employee with active manager 2; 3 = employee with no manager; 4 = employee whose manager (5) separated;
// 6 = employee whose manager (7) has no login link; 8 = employee in OTHER tenant.
let app: Awaited<ReturnType<typeof buildApp>>;
const asT = <T,>(t: string, fn: (tx: typeof sqlClient) => Promise<T>) => withRawTenantGuc(sqlClient, t, fn);

function line(tenant: string, actor: string, secret = process.env.INTERNAL_SERVICE_SECRET!) {
  return app.inject({
    method: "GET", url: `/v1/hrms/internal/employees/actor/${actor}/reporting-line`,
    headers: { "x-internal": "1", "x-service-secret": secret, "x-tenant-id": tenant },
  });
}

async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER]) {
    await asT(t, (tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${t}`);
    await asT(t, (tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${t}`);
    await asT(t, (tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${t}`);
  }
}

async function emp(t: string, n: number, name: string, opts: { manager?: number; status?: string; noLogin?: boolean }) {
  await asT(t, (tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, manager_id, status, created_by, updated_by)
    VALUES (${e(n)}, ${t}, ${"RL-" + n}, ${name}, ${DEPT_OF(t)}, ${DESIG_OF(t)}, '2015-01-01', ${opts.noLogin ? null : login(n)},
            ${opts.manager ? e(opts.manager) : null}, ${opts.status ?? "confirmed"}, ${ACTOR}, ${ACTOR})`);
}

beforeAll(async () => {
  await cleanup();
  for (const t of [TENANT, OTHER]) {
    await asT(t, (tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT_OF(t)}, ${t}, 'RL', 'Dept', ${ACTOR}, ${ACTOR})`);
    await asT(t, (tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG_OF(t)}, ${t}, 'RL', 'Officer', ${ACTOR}, ${ACTOR})`);
  }
  await emp(TENANT, 2, "Manager Two", {});
  await emp(TENANT, 1, "Employee One", { manager: 2 });
  await emp(TENANT, 3, "Employee Three", {});
  await emp(TENANT, 5, "Separated Manager", { status: "separated" });
  await emp(TENANT, 4, "Employee Four", { manager: 5 });
  await emp(TENANT, 7, "Loginless Manager", { noLogin: true });
  await emp(TENANT, 6, "Employee Six", { manager: 7 });
  await emp(OTHER, 8, "Other Tenant Person", {});
  app = await buildApp();
}, 60_000);

afterAll(async () => { await cleanup(); await app.close(); });

describe("internal reporting-line (real DB)", () => {
  it("returns the employee name and the manager's login actor id + name", async () => {
    const res = await line(TENANT, login(1));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ actorId: login(1), fullName: "Employee One", manager: { actorId: login(2), fullName: "Manager Two" } });
  });

  it("no manager recorded -> 200 with manager null (fail soft)", async () => {
    const res = await line(TENANT, login(3));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ fullName: "Employee Three", manager: null });
  });

  it("actor with no linked employee -> 200 with nulls", async () => {
    const res = await line(TENANT, login(99));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ actorId: login(99), fullName: null, manager: null });
  });

  it("a separated manager, or one with no login link, is not returned", async () => {
    expect(((await line(TENANT, login(4))).json() as { manager: unknown }).manager).toBeNull();
    expect(((await line(TENANT, login(6))).json() as { manager: unknown }).manager).toBeNull();
  });

  it("cross-tenant: another tenant's actor resolves to nothing", async () => {
    const res = await line(TENANT, login(8));
    expect(res.json()).toEqual({ actorId: login(8), fullName: null, manager: null });
  });

  it("rejects a wrong service secret and a non-uuid actor", async () => {
    const bad = await line(TENANT, login(1), "wrong-secret");
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    expect(bad.body).not.toContain("Manager Two");
    expect((await line(TENANT, "not-a-uuid")).statusCode).toBe(400);
  });
});
