/**
 * GAP-HR-EMPLOYEES-DETAIL-04 (re-opened GAP-HR-EMPLOYEES-DETAIL-01 /
 * GAP-HR-SF-16): GET /v1/hrms/lifecycle/transfers and
 * GET /v1/hrms/lifecycle/promotions -- the routes employees/[id]/page.tsx
 * actually calls for its profile timeline -- ignored the ?employeeId=
 * filter entirely and returned the WHOLE TENANT's transfer/promotion
 * history (postings, grades) to any HR-role viewer, on EVERY employee's
 * profile. PR #1651 (GAP-HR-SF-16) fixed this exact bug, but in a
 * DIFFERENT route (lifecycle/m7-list-routes.ts's un-prefixed GET
 * /v1/hrms/transfers and /v1/hrms/promotions) that the profile page does
 * not call. GAP-HR-SF-17 (#1658), merged later off an older base, rewrote
 * this route's body (to add batch name resolution) from a pre-#1651 copy,
 * silently reintroducing the identical leak in *this* route. This suite
 * proves the fix in the route that is actually live on the profile page.
 *
 * Same isolation pattern as tests/manpower-rls.test.ts /
 * designations-guards.test.ts: a fresh random tenant per run, direct
 * postgres client with the app.tenant_id GUC set before every insert
 * (hrms_transfers/hrms_promotions are FORCE RLS -- migrations 0026/0034),
 * so this is safe to run concurrently with other worktrees on a shared
 * dev Postgres.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://hrms_svc:hrms_dev_pw@localhost:5435/civitas_hrms";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sql: any;
const TENANT = randomUUID();
const ACTOR = randomUUID();
const EMP_A = randomUUID();
const EMP_B = randomUUID();

function token() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["hr_admin"], sid: "s1" }, SECRET);
}

async function setTenant() {
  await sql`select set_config('app.tenant_id', ${TENANT}, false)`;
}

async function seedTransfer(employeeId: string) {
  await setTenant();
  await sql`insert into lifecycle.hrms_transfers
      (id, tenant_id, employee_id, from_dept_id, to_dept_id, effective_date, status, created_by, updated_by)
    values
      (${randomUUID()}::uuid, ${TENANT}::uuid, ${employeeId}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid, '2026-01-01', 'ordered', ${ACTOR}::uuid, ${ACTOR}::uuid)`;
}

async function seedPromotion(employeeId: string) {
  await setTenant();
  await sql`insert into lifecycle.hrms_promotions
      (id, tenant_id, employee_id, from_desig_id, to_desig_id, effective_date, status, created_by, updated_by)
    values
      (${randomUUID()}::uuid, ${TENANT}::uuid, ${employeeId}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid, '2026-01-01', 'ordered', ${ACTOR}::uuid, ${ACTOR}::uuid)`;
}

beforeAll(async () => {
  sql = postgres(DATABASE_URL, { max: 1 });
  await seedTransfer(EMP_A);
  await seedTransfer(EMP_B);
  await seedPromotion(EMP_A);
  await seedPromotion(EMP_B);
});

afterAll(async () => {
  await setTenant();
  await sql`delete from lifecycle.hrms_transfers where tenant_id = ${TENANT}::uuid`;
  await sql`delete from lifecycle.hrms_promotions where tenant_id = ${TENANT}::uuid`;
  await sql.end();
});

describe("GET /v1/hrms/lifecycle/transfers -- ?employeeId= scoping", () => {
  it("returns only the requested employee's transfers, not the whole tenant's", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/lifecycle/transfers?employeeId=${EMP_A}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();

    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: Array<{ employeeId: string }> };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((row) => row.employeeId === EMP_A)).toBe(true);
  });

  it("still returns every transfer tenant-wide when employeeId is omitted (register-page callers)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/lifecycle/transfers",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();

    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: Array<{ employeeId: string }> };
    const ids = new Set(body.data.map((row) => row.employeeId));
    expect(ids.has(EMP_A)).toBe(true);
    expect(ids.has(EMP_B)).toBe(true);
  });
});

describe("GET /v1/hrms/lifecycle/promotions -- ?employeeId= scoping", () => {
  it("returns only the requested employee's promotions, not the whole tenant's", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/lifecycle/promotions?employeeId=${EMP_A}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();

    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: Array<{ employeeId: string }> };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((row) => row.employeeId === EMP_A)).toBe(true);
  });

  it("rejects a non-uuid employeeId with 400, not a silent no-op filter", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/lifecycle/promotions?employeeId=not-a-uuid",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();

    expect(r.statusCode).toBe(400);
  });
});
