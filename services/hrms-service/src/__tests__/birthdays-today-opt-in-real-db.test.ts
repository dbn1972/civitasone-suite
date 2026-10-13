/**
 * GET /v1/hrms/birthdays/today honours the employee's share_birthday opt-in
 * (real-DB + real HTTP route round-trip).
 *
 * The twin route GET /v1/hrms/social/feed already filtered on
 * e.share_birthday = true (GAP-HR-SOCIAL-FEED-01); this standalone route ran
 * the same query without the flag, so an employee who had NOT opted in still
 * had their name, department and designation listed tenant-wide. Seeds three
 * employees against a real Postgres (RLS included) and asserts only the
 * opted-in employee whose birthday is today (IST) is returned.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT = "facade00-1d06-4000-8000-000000001d06";
const SEED_ACTOR = "facade00-1d06-4000-8000-000000001d99";
const DEPT_ID = "facade00-1d06-4000-8000-000000001dd1";
const DESIG_ID = "facade00-1d06-4000-8000-000000001dd2";
const OPTED_IN_TODAY = "facade00-1d06-4000-8000-000000001de1";
const OPTED_OUT_TODAY = "facade00-1d06-4000-8000-000000001de2";
const OPTED_IN_OTHER_DAY = "facade00-1d06-4000-8000-000000001de3";

let app: Awaited<ReturnType<typeof buildApp>>;

function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

async function seedEmployee(id: string, no: string, name: string, dobExpr: "today" | "tomorrow", share: boolean) {
  // The route's "today" is Asia/Kolkata, so the fixture birthday is derived
  // the same way (a year in the past keeps it a plausible date_of_birth).
  const offsetDays = dobExpr === "today" ? 0 : 1;
  await asTenant(
    (tx) => tx`
      INSERT INTO employee.hrms_employees
        (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, date_of_birth,
         email, status, share_birthday, created_by, updated_by)
      VALUES
        (${id}, ${TENANT}, ${no}, ${name}, ${DEPT_ID}, ${DESIG_ID}, '2022-01-01',
         ((NOW() AT TIME ZONE 'Asia/Kolkata')::date + ${offsetDays}::int) - INTERVAL '30 years',
         ${no.toLowerCase() + "@example.gov.in"}, 'confirmed', ${share}, ${SEED_ACTOR}, ${SEED_ACTOR})
    `,
  );
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_ID}, ${TENANT}, 'BDAY', 'Birthday Test Dept', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'BDAY', 'Birthday Test Designation', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await seedEmployee(OPTED_IN_TODAY, "E1D06001", "Opted In Today", "today", true);
  await seedEmployee(OPTED_OUT_TODAY, "E1D06002", "Opted Out Today", "today", false);
  await seedEmployee(OPTED_IN_OTHER_DAY, "E1D06003", "Opted In Other Day", "tomorrow", true);
  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/birthdays/today — share_birthday opt-in", () => {
  it("lists an opted-in employee whose birthday is today and never an opted-out one", async () => {
    const token = signToken({ sub: "bday-viewer-1d06", tid: TENANT, roles: ["employee"], sid: "sess-bday-1d06" }, SECRET);
    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/birthdays/today",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { data: Array<{ id: string }> }).data.map((r) => r.id);
    expect(ids).toContain(OPTED_IN_TODAY);
    expect(ids).not.toContain(OPTED_OUT_TODAY);
    expect(ids).not.toContain(OPTED_IN_OTHER_DAY);
  });

  it("returns an empty list once the only birthday-today employee is opted out", async () => {
    await asTenant((tx) => tx`UPDATE employee.hrms_employees SET share_birthday = false WHERE id = ${OPTED_IN_TODAY}`);
    const token = signToken({ sub: "bday-viewer-1d06", tid: TENANT, roles: ["employee"], sid: "sess-bday-1d06" }, SECRET);
    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/birthdays/today",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: unknown[] }).data).toEqual([]);
  });
});
