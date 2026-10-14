/**
 * GAP-HR-SF-17b: hrms-service's internal employee-summaries feed (the sanctioned
 * display-enrichment endpoint payroll/estab/analytics call) gains an `actorIds`
 * filter and a `userRef` field, so services whose "created by"/"owner" columns hold
 * an identity-provider subject can show a person's name.
 *
 * Real DB, FORCE RLS, real route over the real Fastify app. Seeds 2100 employees
 * (more than the unfiltered feed's 2000-row cap) and proves: the ids/actorIds
 * filters reach past the cap, a request for another tenant's ids/actors returns
 * nothing (no cross-tenant name leak), and the internal gate still rejects a bad
 * service secret.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

process.env.INTERNAL_SERVICE_SECRET = globalThis.crypto.randomUUID();

const TENANT = "beef0000-0000-4000-8000-00000017b301";
const OTHER = "beef0000-0000-4000-8000-00000017b302";
const ACTOR = "beef0000-0000-4000-8000-00000017b3a0";
const DEPT = "beef0000-0000-4000-8000-00000017b3da";
const DEPT_O = "beef0000-0000-4000-8000-00000017b3db";
const DESIG = "beef0000-0000-4000-8000-00000017b3d1";
const DESIG_O = "beef0000-0000-4000-8000-00000017b3d2";
const FOREIGN_EMP = "beef0000-0000-4000-9000-00000017b3e0";
const FOREIGN_LOGIN = "beef0000-0000-4000-a000-00000017b3e0";
const N = 2100;
const empId = (i: number) => `beef0000-0000-4000-9000-${String(i).padStart(12, "0")}`;
const loginOf = (i: number) => `beef0000-0000-4000-a000-${String(i).padStart(12, "0")}`;

let app: Awaited<ReturnType<typeof buildApp>>;
const asT = <T,>(t: string, fn: (tx: typeof sqlClient) => Promise<T>) => withRawTenantGuc(sqlClient, t, fn);

function feed(tenant: string, qs: string, secret = process.env.INTERNAL_SERVICE_SECRET!) {
  return app.inject({
    method: "GET",
    url: `/v1/hrms/internal/employee-summaries${qs}`,
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

beforeAll(async () => {
  await cleanup();
  for (const [t, d, g, dn] of [[TENANT, DEPT, DESIG, "Revenue Dept 17b"], [OTHER, DEPT_O, DESIG_O, "Other Dept"]] as const) {
    await asT(t, (tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${d}, ${t}, 'S17B', ${dn}, ${ACTOR}, ${ACTOR})`);
    await asT(t, (tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${g}, ${t}, 'S17B', 'Clerk', ${ACTOR}, ${ACTOR})`);
  }
  await asT(OTHER, (tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
    VALUES (${FOREIGN_EMP}, ${OTHER}, 'S17B-F', 'Foreign Tenant Person', ${DEPT_O}, ${DESIG_O}, '2015-01-01', ${FOREIGN_LOGIN}, ${ACTOR}, ${ACTOR})`);
  await asT(TENANT, (tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
    SELECT ('beef0000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid, ${TENANT}, 'S17B-' || g,
           'Sf17b Person ' || lpad(g::text, 4, '0'), ${DEPT}, ${DESIG}, '2015-01-01',
           ('beef0000-0000-4000-a000-' || lpad(g::text, 12, '0')), ${ACTOR}, ${ACTOR}
      FROM generate_series(1, ${N}) g`);
  app = await buildApp();
}, 120_000);

afterAll(async () => {
  await cleanup();
  await app.close();
});

describe("SF-17b internal employee-summaries (real DB)", () => {
  it("the unfiltered feed is capped at 2000 and misses the last employee (the bug the filters avoid)", async () => {
    const res = await feed(TENANT, "");
    const rows = res.json() as Array<{ id: string }>;
    expect(rows).toHaveLength(2000);
    expect(rows.some((r) => r.id === empId(N))).toBe(false);
  });

  it("ids= reaches past the cap and returns the login link", async () => {
    const res = await feed(TENANT, `?ids=${empId(N)},${empId(1)}`);
    const rows = res.json() as Array<{ id: string; fullName: string; userRef: string | null; departmentName: string }>;
    expect(rows.map((r) => r.id).sort()).toEqual([empId(1), empId(N)].sort());
    const last = rows.find((r) => r.id === empId(N))!;
    expect(last.fullName).toBe("Sf17b Person 2100");
    expect(last.userRef).toBe(loginOf(N));
    expect(last.departmentName).toBe("Revenue Dept 17b");
  });

  it("actorIds= resolves identity-provider subjects to names", async () => {
    const res = await feed(TENANT, `?actorIds=${loginOf(N)},${loginOf(5)}`);
    const rows = res.json() as Array<{ id: string; fullName: string; userRef: string }>;
    expect(rows.map((r) => r.fullName).sort()).toEqual(["Sf17b Person 0005", "Sf17b Person 2100"]);
  });

  it("cross-tenant: another tenant's employee id and login resolve to nothing", async () => {
    const byId = (await feed(TENANT, `?ids=${FOREIGN_EMP}`)).json() as unknown[];
    const byActor = (await feed(TENANT, `?actorIds=${FOREIGN_LOGIN}`)).json() as unknown[];
    expect(byId).toEqual([]);
    expect(byActor).toEqual([]);
    // and the other tenant still sees its own
    const own = (await feed(OTHER, `?actorIds=${FOREIGN_LOGIN}`)).json() as Array<{ fullName: string }>;
    expect(own.map((r) => r.fullName)).toEqual(["Foreign Tenant Person"]);
  });

  it("an actorIds list with no valid uuid matches nothing (never degrades to the full feed)", async () => {
    const rows = (await feed(TENANT, "?actorIds=not-a-uuid")).json() as unknown[];
    expect(rows).toEqual([]);
  });

  it("the internal gate still rejects a wrong service secret", async () => {
    const res = await feed(TENANT, `?actorIds=${loginOf(1)}`, "wrong-secret");
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.body).not.toContain("Sf17b Person");
  });
});
