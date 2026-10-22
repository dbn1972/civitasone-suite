/**
 * GAP-HR-SERVICE-BOOK-04 -- GET /v1/hrms/service-book (tenant-wide HR list), real DB:
 *
 *   - newest entries first (ORDER BY effective_date DESC): once a scope holds more
 *     rows than the page size, the OLDEST are cut, never the newest;
 *   - limit / offset page through the scope and `meta.hasMore` is exact;
 *   - every stat in `meta` (total, employeesTotal, transfersTotal, promotionsTotal)
 *     is a FULL-SCOPE aggregate, independent of the page returned;
 *   - ?employeeId= narrows both the rows and the aggregates to that employee.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET as string; // set by this service vitest.config.ts
const TENANT = "facade00-5b04-4000-8000-000000005b04";
const SEED = "facade00-5b04-4000-8000-0000000000ff";
const DEPT = "facade00-5b04-4000-8000-0000000000d1";
const DESIG = "facade00-5b04-4000-8000-0000000000d2";
const EMP_A = "facade00-5b04-4000-8000-0000000000e1";
const EMP_B = "facade00-5b04-4000-8000-0000000000e2";

const hr = { authorization: `Bearer ${signToken({ sub: "sb04-hr", tid: TENANT, roles: ["hr_admin"], sid: "sess-sb04" }, SECRET)}` };
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, TENANT, fn);

let app: Awaited<ReturnType<typeof buildApp>>;

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM lifecycle.hrms_service_book_entries WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

// EMP_A: join 2020-01-01, transfer 2021-01-01, promotion 2022-01-01, posting 2023-01-01, increment 2024-01-01
// EMP_B: join 2021-06-01, training 2022-06-01
const ENTRIES: Array<[string, string, string, string]> = [
  [EMP_A, "join", "2020-01-01", "A joined"],
  [EMP_A, "transfer", "2021-01-01", "A transferred"],
  [EMP_A, "promotion", "2022-01-01", "A promoted"],
  [EMP_A, "posting", "2023-01-01", "A posted"],
  [EMP_A, "increment", "2024-01-01", "A increment"],
  [EMP_B, "join", "2021-06-01", "B joined"],
  [EMP_B, "training", "2022-06-01", "B trained"],
];

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT}, ${TENANT}, 'SB04D', 'SB04 Dept', ${SEED}, ${SEED})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG}, ${TENANT}, 'SB04S', 'SB04 Desig', ${SEED}, ${SEED})`);
  for (const [id, no, name] of [[EMP_A, "SB04-001", "Asha Anand"], [EMP_B, "SB04-002", "Bala Bhat"]] as const) {
    await asTenant((tx) => tx`
      INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
      VALUES (${id}, ${TENANT}, ${no}, ${name}, ${DEPT}, ${DESIG}, '2020-01-01', ${SEED}, ${SEED})`);
  }
  for (const [emp, type, date, desc] of ENTRIES) {
    await asTenant((tx) => tx`
      INSERT INTO lifecycle.hrms_service_book_entries (id, tenant_id, employee_id, entry_type, effective_date, description, recorded_by)
      VALUES (gen_random_uuid(), ${TENANT}, ${emp}, ${type}, ${date}, ${desc}, ${SEED})`);
  }
  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

type ListBody = {
  data: Array<{ detail: string; employeeId: string; employee: string; eventType: string; effectiveDate: string }>;
  meta: { total: number; hasMore: boolean; employeesTotal: number; transfersTotal: number; promotionsTotal: number };
};
async function list(query = ""): Promise<ListBody> {
  const r = await app.inject({ method: "GET", url: `/v1/hrms/service-book${query}`, headers: hr });
  expect(r.statusCode).toBe(200);
  return JSON.parse(r.body) as ListBody;
}

describe("GET /v1/hrms/service-book (GAP-HR-SERVICE-BOOK-04)", () => {
  it("returns the newest entry first, and emits employeeId and the resolved employee name per row", async () => {
    const body = await list();
    expect(body.data.map((e) => e.detail)).toEqual([
      "A increment", "A posted", "B trained", "A promoted", "B joined", "A transferred", "A joined",
    ]);
    expect(body.data[0]).toMatchObject({ employeeId: EMP_A, employee: "Asha Anand", eventType: "increment" });
  });

  it("limit cuts the OLDEST rows, never the newest, and meta.hasMore is exact", async () => {
    const page1 = await list("?limit=3");
    expect(page1.data.map((e) => e.detail)).toEqual(["A increment", "A posted", "B trained"]);
    expect(page1.meta).toMatchObject({ total: 7, hasMore: true });

    const last = await list("?limit=3&offset=6");
    expect(last.data.map((e) => e.detail)).toEqual(["A joined"]);
    expect(last.meta.hasMore).toBe(false);
  });

  it("offset pages through the rest in order", async () => {
    const page2 = await list("?limit=3&offset=3");
    expect(page2.data.map((e) => e.detail)).toEqual(["A promoted", "B joined", "A transferred"]);
    expect(page2.meta.hasMore).toBe(true);
  });

  it("every stat is a full-scope aggregate, unaffected by the page that was returned", async () => {
    const tiny = await list("?limit=1");
    expect(tiny.data).toHaveLength(1);
    expect(tiny.meta).toMatchObject({ total: 7, employeesTotal: 2, transfersTotal: 2, promotionsTotal: 2 });
  });

  it("?employeeId= narrows the rows and every aggregate to that employee", async () => {
    const b = await list(`?employeeId=${EMP_B}`);
    expect(b.data.map((e) => e.detail)).toEqual(["B trained", "B joined"]);
    expect(b.meta).toMatchObject({ total: 2, employeesTotal: 1, transfersTotal: 0, promotionsTotal: 0, hasMore: false });
  });

  it("rejects an out-of-range limit (the page size is bounded)", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/service-book?limit=5000", headers: hr });
    expect(r.statusCode).toBe(400);
  });
});
