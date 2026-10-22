/**
 * GET /v1/hrms/overtime-requests — hasMore/total (real DB, no mocks).
 *
 * GAP-HR-OVERTIME-04 (pagination half — the manager-scope half of this gap
 * was already closed server-side by resolveSelfScopedEmployeeId, proven by
 * attendance-manager-scope-real-db.test.ts). The route silently truncated
 * at 200 rows with no signal at all; a tenant with >200 rows had its page
 * and stat cards computed from an incomplete, arbitrarily-ordered window
 * with no indication anything was missing. Uses a small `limit` query param
 * (not 200+ seed rows) to exercise the same hasMore/total logic cheaply.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc, withTenantScope } from "@civitasone/db";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { hrmsEmployees } from "../modules/employee/schema.js";
import { hrmsOvertimeRequests } from "../modules/attendance/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const SEED_ACTOR = randomUUID();
const HR_SUB = "overtime-page-hr";

function auth(sub: string, roles: string[]): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-overtime-page-test" }, SECRET, 3600)}` };
}

let app: FastifyInstance;
let empId: string;

async function seedOvertime(requestDate: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsOvertimeRequests).values({
    id: randomUUID(), tenantId: TENANT, employeeId: empId, requestDate,
    hoursRequested: "2.00", status: "pending",
    createdBy: SEED_ACTOR, updatedBy: SEED_ACTOR,
  }));
}

beforeAll(async () => {
  app = await buildApp();
  empId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsEmployees).values({
    id: empId, tenantId: TENANT, userRef: HR_SUB,
    employeeNo: "OTP-001", fullName: "Overtime Page Employee",
    departmentId: randomUUID(), designationId: randomUUID(), dateOfJoining: "2020-01-15",
    createdBy: SEED_ACTOR, updatedBy: SEED_ACTOR,
  }));
  for (const d of ["2026-05-01", "2026-05-02", "2026-05-03"]) {
    await seedOvertime(d);
  }
});

/** Every tenant this file seeds, so afterAll can remove its rows (the sibling real-DB tests clean up too). */
const seededTenants: string[] = [TENANT];

afterAll(async () => {
  for (const tenant of seededTenants) {
    await withRawTenantGuc(sqlClient, tenant, async (tx) => {
      await tx`DELETE FROM attendance.hrms_overtime_requests WHERE tenant_id = ${tenant}`;
      await tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${tenant}`;
    });
  }
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/overtime-requests — hasMore/total", () => {
  it("hasMore=false and total equals the real row count when everything fits", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/overtime-requests", headers: auth(HR_SUB, ["hr_admin"]) });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.hasMore).toBe(false);
    expect(body.total).toBe(3);
    expect(body.data).toHaveLength(3);
  });

  it("hasMore=true and total is the REAL total (3), not the truncated page length, when limit truncates the page", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/overtime-requests?limit=2", headers: auth(HR_SUB, ["hr_admin"]) });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.hasMore).toBe(true);
    expect(body.total).toBe(3);
    expect(body.data).toHaveLength(2);
  });

  it("offset pages through without duplicating or dropping rows", async () => {
    const page1 = await app.inject({ method: "GET", url: "/v1/hrms/overtime-requests?limit=2&offset=0", headers: auth(HR_SUB, ["hr_admin"]) });
    const page2 = await app.inject({ method: "GET", url: "/v1/hrms/overtime-requests?limit=2&offset=2", headers: auth(HR_SUB, ["hr_admin"]) });
    const ids1 = (page1.json().data as Array<{ id: string }>).map((r) => r.id);
    const ids2 = (page2.json().data as Array<{ id: string }>).map((r) => r.id);
    expect(ids1.length).toBe(2);
    expect(ids2.length).toBe(1);
    expect(new Set([...ids1, ...ids2]).size).toBe(3); // no overlap, nothing missing
  });
});

/**
 * GAP-HR-OVERTIME-04 rework: the page query ordered ONLY by request_date,
 * which is not unique (many requests share one date). With LIMIT/OFFSET,
 * Postgres is free to return tied rows in a different order for every
 * (limit, offset) window, so consecutive pages overlapped and skipped rows
 * (reproduced on a disposable Postgres: 300 rows over 3 dates paged 20 at a
 * time returned 231 distinct ids, some repeated 2-4 times). The 3-row test
 * above has one row per date, so it can never see this. These tests seed
 * several pages of rows that all share the same request_date.
 */
describe("GET /v1/hrms/overtime-requests — paging over rows that share a request_date", () => {
  const TIE_SUB = "overtime-tie-hr";

  function authFor(tenant: string): { authorization: string } {
    return { authorization: `Bearer ${signToken({ sub: TIE_SUB, tid: tenant, roles: ["hr_admin"], sid: "sess-overtime-tie-test" }, SECRET, 3600)}` };
  }

  /** Fresh tenant + employee so the row counts are exact and independent of the block above. */
  async function seedTenant(rowsByDate: Record<string, number>): Promise<{ tenant: string; ids: Array<{ id: string; requestDate: string }> }> {
    const tenant = randomUUID();
    seededTenants.push(tenant);
    const employee = randomUUID();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await withTenantScope(db, tenant, (tx: any) => tx.insert(hrmsEmployees).values({
      id: employee, tenantId: tenant, userRef: TIE_SUB,
      employeeNo: "OTP-TIE", fullName: "Overtime Tie Employee",
      departmentId: randomUUID(), designationId: randomUUID(), dateOfJoining: "2020-01-15",
      createdBy: SEED_ACTOR, updatedBy: SEED_ACTOR,
    }));
    const rows = Object.entries(rowsByDate).flatMap(([requestDate, n]) =>
      Array.from({ length: n }, () => ({
        id: randomUUID(), tenantId: tenant, employeeId: employee, requestDate,
        hoursRequested: "2.00", status: "pending",
        createdBy: SEED_ACTOR, updatedBy: SEED_ACTOR,
      })));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await withTenantScope(db, tenant, (tx: any) => tx.insert(hrmsOvertimeRequests).values(rows));
    return { tenant, ids: rows.map((r) => ({ id: r.id, requestDate: r.requestDate })) };
  }

  async function fetchPage(tenant: string, limit: number, offset: number): Promise<{ ids: string[]; hasMore: boolean; total: number }> {
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/overtime-requests?limit=${limit}&offset=${offset}`,
      headers: authFor(tenant),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: Array<{ id: string }>; hasMore: boolean; total: number };
    return { ids: body.data.map((d) => d.id), hasMore: body.hasMore, total: body.total };
  }

  it("limit=2 at offset 0,2,4,6 over 7 rows on ONE request_date returns every id exactly once", async () => {
    const { tenant, ids } = await seedTenant({ "2026-06-10": 7 });
    const seen: string[] = [];
    const flags: boolean[] = [];
    for (const offset of [0, 2, 4, 6]) {
      const page = await fetchPage(tenant, 2, offset);
      expect(page.total).toBe(7);
      seen.push(...page.ids);
      flags.push(page.hasMore);
    }
    expect(seen).toHaveLength(7); // no row repeated, none dropped
    expect(new Set(seen).size).toBe(7);
    expect([...seen].sort()).toEqual(ids.map((i) => i.id).sort());
    expect(flags).toEqual([true, true, true, false]);
  });

  it("an empty-scope caller (employee role with no linked employee record) gets the SAME envelope, with an all-zero summary", async () => {
    const { tenant } = await seedTenant({ "2026-06-10": 3 });
    const unlinked = `Bearer ${signToken({ sub: "overtime-tie-unlinked", tid: tenant, roles: ["employee"], sid: "sess-overtime-tie-test" }, SECRET, 3600)}`;
    const r = await app.inject({ method: "GET", url: "/v1/hrms/overtime-requests", headers: { authorization: unlinked } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      data: [],
      hasMore: false,
      total: 0,
      summary: { total: 0, pending: 0, approved: 0, rejected: 0, approvedHours: 0 },
    });
  });

  it("walking 60 rows spread over 3 dates (20 per date) 7 at a time visits every id once, in request_date desc then id desc order", async () => {
    const { tenant, ids } = await seedTenant({ "2026-06-10": 20, "2026-06-11": 20, "2026-06-12": 20 });
    const seen: string[] = [];
    for (let offset = 0; offset < 60; offset += 7) {
      const page = await fetchPage(tenant, 7, offset);
      seen.push(...page.ids);
      expect(page.hasMore).toBe(offset + 7 < 60);
    }
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
    // The tiebreak is part of the contract (a stable, repeatable order), not
    // an accident of the planner: newest date first, id descending inside a date.
    const expected = [...ids]
      .sort((a, b) => (a.requestDate === b.requestDate ? (a.id < b.id ? 1 : -1) : a.requestDate < b.requestDate ? 1 : -1))
      .map((i) => i.id);
    expect(seen).toEqual(expected);
  });
});
