/**
 * GAP-HR-CONTRACTUAL-03/04 -- GET /v1/hrms/contracts, real DB:
 *
 *   - sort=endDate returns the soonest-ending contract first, with a stable
 *     tie-break so paging never repeats or skips a row;
 *   - summary=true adds meta.summary: FULL-SCOPE register counts classified by
 *     contract status AND end date against the IST calendar date -- an active
 *     contract past its end date is Expired (not Active), a contract ending
 *     within 30 days is Expiring, terminated/renewed/draft are in none;
 *   - the counts do not depend on the page that was returned, and a manager's
 *     counts are confined to their own scope;
 *   - without the flags the response is unchanged (no meta.summary).
 *
 * Only Date is faked (so "today" is fixed), the JWT is signed after the clock is
 * set so its iat/exp are valid against the faked now.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET as string; // set by this service vitest.config.ts
const TENANT = "facade00-c034-4000-8000-00000000c034";
const SEED = "facade00-c034-4000-8000-0000000000ff";
const id = (n: number): string => `facade00-c034-4000-8000-00000000${String(n).padStart(4, "0")}`;
const DEPT = id(0x1d1), DESIG = id(0x1d2);
const E1 = id(0x1e1), E2 = id(0x1e2), E3 = id(0x1e3), E4 = id(0x1e4), E5 = id(0x1e5);
const MGR_SUB = id(0x3a1);

// "Now" is 11:30 IST on 15 June 2026 -> IST today 2026-06-15 (30-day window ends 2026-07-15).
const NOW = "2026-06-15T06:00:00Z";

const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, TENANT, fn);
let app: Awaited<ReturnType<typeof buildApp>>;

function headers(roles: string[], sub: string): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-c034" }, SECRET)}` };
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM contracts.hrms_contracts WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

// [contract id, employee, no, status, end date]. At most ONE 'active' contract per employee (partial unique index
// uq_contracts_employee_active), so each active contract below belongs to a different employee.
const CONTRACTS: Array<[string, string, string, string, string]> = [
  [id(0xc01), E1, "C-01", "active", "2026-06-14"],     // ended yesterday but still 'active' -> Expired (not Active)
  [id(0xc02), E2, "C-02", "active", "2026-06-25"],     // 10 days left       -> Active + Expiring
  [id(0xc03), E3, "C-03", "active", "2027-01-01"],     // far off            -> Active
  [id(0xc04), E2, "C-04", "expiring", "2026-07-30"],   // scheduler-flagged, 45 days left -> Expiring
  [id(0xc05), E3, "C-05", "expired", "2026-05-01"],    // -> Expired
  [id(0xc06), E3, "C-06", "terminated", "2026-06-10"], // none
  [id(0xc07), E3, "C-07", "renewed", "2026-06-01"],    // none
  [id(0xc08), E4, "C-08", "active", "2026-06-15"],     // ends today -> Active + Expiring, not Expired
  [id(0xc09), E5, "C-09", "draft", "2026-06-01"],      // not in force -> none
  [id(0xc10), E1, "C-10", "expiring", "2026-07-01"],   // 16 days left, flagged -> Expiring
];

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT}, ${TENANT}, 'C034D', 'C034 Dept', ${SEED}, ${SEED})`);
  await asTenant((tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, level, created_by, updated_by) VALUES (${DESIG}, ${TENANT}, 'C034S', 'C034 Desig', 5, ${SEED}, ${SEED})`);
  // E1 is the manager-role caller's own record (user_ref), with no direct reports.
  for (const [eid, no, name, agency, userRef] of [
    [E1, "C034-1", "Esha One", "AGENCY-1", MGR_SUB],
    [E2, "C034-2", "Esha Two", "AGENCY-1", null],
    [E3, "C034-3", "Esha Three", "AGENCY-2", null],
    [E4, "C034-4", "Esha Four", "AGENCY-2", null],
    [E5, "C034-5", "Esha Five", null, null],
  ] as const) {
    await asTenant((tx) => tx`
      INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, agency_ref, user_ref, created_by, updated_by)
      VALUES (${eid}, ${TENANT}, ${no}, ${name}, ${DEPT}, ${DESIG}, '2025-01-01', ${agency}, ${userRef}, ${SEED}, ${SEED})`);
  }
  for (const [cid, emp, no, status, end] of CONTRACTS) {
    await asTenant((tx) => tx`
      INSERT INTO contracts.hrms_contracts (id, tenant_id, employee_id, contract_no, start_date, end_date, status, created_by, updated_by)
      VALUES (${cid}, ${TENANT}, ${emp}, ${no}, '2025-01-01', ${end}, ${status}, ${SEED}, ${SEED})`);
  }
  app = await buildApp();
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

type Body = {
  data: Array<{ id: string; endDate: string }>;
  meta: { page: number; pageSize: number; total: number; summary?: { active: number; expiring: number; expired: number; agencies: number } };
};
async function list(query: string, roles = ["hr_admin"], sub = id(0x3a9)): Promise<Body> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  const r = await app.inject({ method: "GET", url: `/v1/hrms/contracts${query}`, headers: headers(roles, sub) });
  expect(r.statusCode).toBe(200);
  return JSON.parse(r.body) as Body;
}

describe("GET /v1/hrms/contracts?sort=endDate", () => {
  it("returns the soonest-ending contract first, tie-broken by id", async () => {
    const body = await list("?sort=endDate&limit=200");
    const ends = body.data.map((c) => c.endDate);
    expect(ends).toEqual([...ends].sort());
    expect(body.data[0]!.id).toBe(id(0xc05)); // 2026-05-01, the earliest
    // The two 2026-06-01 contracts are adjacent and ordered by id.
    const june1 = body.data.filter((c) => c.endDate === "2026-06-01").map((c) => c.id);
    expect(june1).toEqual([id(0xc07), id(0xc09)]);
  });

  it("pages through the scope without repeating or skipping a row", async () => {
    const p1 = await list("?sort=endDate&limit=4&offset=0");
    const p2 = await list("?sort=endDate&limit=4&offset=4");
    const p3 = await list("?sort=endDate&limit=4&offset=8");
    const all = [...p1.data, ...p2.data, ...p3.data].map((c) => c.id);
    expect(new Set(all).size).toBe(10);
    expect(p2.meta).toMatchObject({ page: 2, pageSize: 4, total: 10 });
  });

  it("keeps the default createdAt-desc ordering and shape when the flag is absent", async () => {
    const body = await list("?limit=200");
    expect(body.meta.summary).toBeUndefined();
    expect(body.data).toHaveLength(10);
  });
});

describe("GET /v1/hrms/contracts?summary=true (full-scope register counts)", () => {
  it("classifies by status AND end date against the IST today: an active contract past its end is Expired, not Active", async () => {
    const body = await list("?summary=true&limit=200");
    expect(body.meta.total).toBe(10);
    // active: C-02, C-03, C-08 | expiring: C-02, C-04, C-08, C-10 | expired: C-01, C-05 | agencies: AGENCY-1, AGENCY-2
    expect(body.meta.summary).toEqual({ active: 3, expiring: 4, expired: 2, agencies: 2 });
  });

  it("is independent of the page returned: a one-row page still reports the whole scope", async () => {
    const body = await list("?summary=true&limit=1&offset=3&sort=endDate");
    expect(body.data).toHaveLength(1);
    expect(body.meta.total).toBe(10);
    expect(body.meta.summary).toEqual({ active: 3, expiring: 4, expired: 2, agencies: 2 });
  });

  it("uses the IST date, not the UTC date, for 'past its end date'", async () => {
    // 2026-06-14T19:00Z is 00:30 IST on 15 June, but the UTC date is still 14 June.
    // C-01 (active, ended 14 June) is therefore already past its end in IST...
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-14T19:00:00Z"));
    const r = await app.inject({ method: "GET", url: "/v1/hrms/contracts?summary=true&limit=200", headers: headers(["hr_admin"], id(0x3a9)) });
    const body = JSON.parse(r.body) as Body;
    // ...whereas by the UTC date it would still be ending "today" and NOT expired.
    expect(body.meta.summary!.expired).toBe(2);
    expect(body.meta.summary!.active).toBe(3);
  });

  it("confines a manager's counts to their own scope (self + direct reports)", async () => {
    // The manager-role caller resolves to E1 only (two contracts: C-01 active-but-ended = Expired, C-10 Expiring).
    const body = await list("?summary=true&limit=200", ["manager"], MGR_SUB);
    expect(body.meta.total).toBe(2);
    expect(body.meta.summary).toEqual({ active: 0, expiring: 1, expired: 1, agencies: 1 });
  });
});
