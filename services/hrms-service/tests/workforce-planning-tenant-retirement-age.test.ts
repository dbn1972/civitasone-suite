/**
 * GAP-HR-WORKFORCE-07 -- the superannuation age is a per-tenant policy
 * (`retirement_age`, policy-settings/registry.ts), not a module constant.
 *
 * Real DB. Two fresh tenants get the SAME three employees; one tenant keeps
 * the default (no stored row == 60, the historical behaviour), the other sets
 * 58 through the real policy-settings PUT + consumer. Both forecast endpoints
 * must then move employees between horizons for the 58 tenant only, and
 * report the age they actually used in meta.retirementAge.
 *
 *   A  59y 6m old  -> at 60 retires in ~6 months   -> at 58 already past
 *   B  56y 6m old  -> at 60 retires in ~3.5 years  -> at 58 in ~1.5 years
 *   C  57y 9m old  -> at 60 retires in ~2.25 years -> at 58 in ~3 months
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPolicySettingsConsumers } from "../src/modules/policy-settings/consumer.js";

registerPolicySettingsConsumers(queue);
const drain = (): Promise<void> => (queue as unknown as { drain: () => Promise<void> }).drain();

const JWT = process.env.JWT_SECRET as string;
const T_DEFAULT = randomUUID();
const T_58 = randomUUID();
const ACTOR = randomUUID();

const headers = (tenant: string, roles = ["hr_admin"]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "sess-ret-age" }, JWT)}`,
});
const asTenant = <T>(tenant: string, fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, tenant, fn);

let app: Awaited<ReturnType<typeof buildApp>>;

async function seed(tenant: string) {
  const dept = randomUUID();
  const desig = randomUUID();
  await asTenant(tenant, (tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${dept}, ${tenant}, 'RA', 'Ret Age Dept', ${ACTOR}, ${ACTOR})`);
  await asTenant(tenant, (tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, level, created_by, updated_by) VALUES (${desig}, ${tenant}, 'RA', 'Ret Age Role', 0, ${ACTOR}, ${ACTOR})`);
  for (const [no, ago] of [["RA-A", "59 years 6 months"], ["RA-B", "56 years 6 months"], ["RA-C", "57 years 9 months"]] as const) {
    const id = randomUUID();
    await asTenant(tenant, (tx) => tx`
      INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, date_of_birth, employee_type, user_ref, created_by, updated_by)
      VALUES (${id}, ${tenant}, ${no}, ${no}, ${dept}, ${desig}, '2000-01-01', (CURRENT_DATE - ${ago}::interval)::date, 'permanent', ${id}, ${ACTOR}, ${ACTOR})`);
  }
}

async function cleanup(tenant: string) {
  await asTenant(tenant, (tx) => tx`DELETE FROM employee.hrms_policy_settings WHERE tenant_id = ${tenant}`);
  await asTenant(tenant, (tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${tenant}`);
  await asTenant(tenant, (tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${tenant}`);
  await asTenant(tenant, (tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${tenant}`);
}

beforeAll(async () => {
  await seed(T_DEFAULT);
  await seed(T_58);
  app = await buildApp();
  const put = await app.inject({
    method: "PUT", url: "/v1/hrms/policy-settings/retirement_age",
    headers: headers(T_58), payload: { superannuationAge: 58 },
  });
  expect(put.statusCode).toBe(202);
  await drain();
});

afterAll(async () => {
  await cleanup(T_DEFAULT);
  await cleanup(T_58);
  await app.close();
  await sqlClient.end();
});

async function vacancy(tenant: string) {
  const r = await app.inject({ method: "GET", url: "/v1/hrms/workforce/vacancy-forecast", headers: headers(tenant) });
  expect(r.statusCode).toBe(200);
  const body = r.json() as { data: Array<{ horizon: string; count: number }>; meta: { retirementAge: number } };
  return { horizons: Object.fromEntries(body.data.map((d) => [d.horizon, d.count])), age: body.meta.retirementAge };
}

async function retirement(tenant: string) {
  const r = await app.inject({ method: "GET", url: "/v1/hrms/workforce/retirement-forecast?granularity=year&years=5", headers: headers(tenant) });
  expect(r.statusCode).toBe(200);
  const body = r.json() as { data: Array<{ period: string; retiring_count: number }>; meta: { retirementAge: number } };
  return { rows: body.data, age: body.meta.retirementAge };
}

describe("tenant retirement age (GAP-HR-WORKFORCE-07)", () => {
  it("a tenant with no stored policy keeps the historical age of 60 on both endpoints", async () => {
    const v = await vacancy(T_DEFAULT);
    expect(v.age).toBe(60);
    expect(v.horizons).toEqual({ "1_year": 1, "3_years": 1, "5_years": 1 });

    const r = await retirement(T_DEFAULT);
    expect(r.age).toBe(60);
    expect(r.rows.reduce((n, x) => n + x.retiring_count, 0)).toBe(3);
  });

  it("a tenant age of 58 shifts employees between vacancy horizons and reports 58", async () => {
    const v = await vacancy(T_58);
    expect(v.age).toBe(58);
    // B moves 5_years -> 3_years, C moves 3_years -> 1_year, A (already past 58) stays in the first bucket.
    expect(v.horizons).toEqual({ "1_year": 2, "3_years": 1 });
  });

  it("a tenant age of 58 drops the already-past employee and re-dates the rest on the retirement forecast", async () => {
    const r = await retirement(T_58);
    expect(r.age).toBe(58);
    expect(r.rows.reduce((n, x) => n + x.retiring_count, 0)).toBe(2);

    const expectedYears = await asTenant(T_58, (tx) => tx`
      SELECT to_char(date_of_birth + INTERVAL '58 years', 'YYYY') AS y
      FROM employee.hrms_employees
      WHERE tenant_id = ${T_58} AND employee_no IN ('RA-B', 'RA-C') ORDER BY y`);
    const reported = r.rows.flatMap((x) => Array(x.retiring_count).fill(x.period) as string[]).sort();
    expect(reported).toEqual(expectedYears.map((e) => e.y as string));
  });

  it("the policy is tenant-scoped: setting 58 for one tenant does not move the other", async () => {
    expect((await vacancy(T_DEFAULT)).age).toBe(60);
  });

  it("rejects a typo'd age outside the 40-75 sanity bounds, fractions and unknown fields", async () => {
    const tooHigh = await app.inject({ method: "PUT", url: "/v1/hrms/policy-settings/retirement_age", headers: headers(T_58), payload: { superannuationAge: 600 } });
    const tooLow = await app.inject({ method: "PUT", url: "/v1/hrms/policy-settings/retirement_age", headers: headers(T_58), payload: { superannuationAge: 39 } });
    const tooHighJustOver = await app.inject({ method: "PUT", url: "/v1/hrms/policy-settings/retirement_age", headers: headers(T_58), payload: { superannuationAge: 76 } });
    const fractional = await app.inject({ method: "PUT", url: "/v1/hrms/policy-settings/retirement_age", headers: headers(T_58), payload: { superannuationAge: 58.5 } });
    const extra = await app.inject({ method: "PUT", url: "/v1/hrms/policy-settings/retirement_age", headers: headers(T_58), payload: { superannuationAge: 58, note: "x" } });
    for (const r of [tooHigh, tooLow, tooHighJustOver, fractional, extra]) expect(r.statusCode).toBe(400);
    expect((await vacancy(T_58)).age).toBe(58);
  });

  it("a non-admin HR role cannot change the age", async () => {
    const r = await app.inject({ method: "PUT", url: "/v1/hrms/policy-settings/retirement_age", headers: headers(T_58, ["hr_officer"]), payload: { superannuationAge: 62 } });
    expect(r.statusCode).toBe(403);
    await drain();
    expect((await vacancy(T_58)).age).toBe(58);
  });
});
