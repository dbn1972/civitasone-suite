/**
 * Real-DB regression for GAP-HR-WORK-SUMMARY-02:
 *  - an appraisal whose rating is NULL comes back as rating:null (it used to be
 *    COALESCEd to 0, which the page printed as a genuine "0.0 / 5"),
 *  - the response carries per-status counts over the whole scope, which sum to
 *    `total` (the page's stat tiles are bucketed from them).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { hrmsEmployees } from "../modules/employee/schema.js";
import type { FastifyInstance } from "fastify";

// vitest.config.ts injects JWT_SECRET for every service suite; no literal here (gitleaks scans every commit)
const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const HR = randomUUID();

function auth(sub: string, roles: string[]): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-ws-null" }, SECRET, 3600)}` };
}

let app: FastifyInstance;
const EMP: Record<string, string> = {};

async function seedEmployee(userRef: string, name: string): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsEmployees).values({
    id, tenantId: TENANT, employeeNo: `WN-${id.slice(0, 8)}`, fullName: name,
    departmentId: randomUUID(), designationId: randomUUID(), dateOfJoining: "2020-01-15",
    userRef, createdBy: HR, updatedBy: HR,
  }));
  return id;
}

async function seedAppraisal(employeeId: string, period: string, status: string, rating: string | null): Promise<void> {
  await sqlClient.begin(async (sql) => {
    await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [TENANT]);
    await sql.unsafe(
      `INSERT INTO appraisal.hrms_appraisals (id, tenant_id, employee_id, appraisal_period, rating, status, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
      [randomUUID(), TENANT, employeeId, period, rating, status, HR],
    );
  });
}

beforeAll(async () => {
  app = await buildApp();
  EMP.alice = await seedEmployee("wn-alice", "Alice WN");
  EMP.bob = await seedEmployee("wn-bob", "Bob WN");
  // alice: unrated, mid-workflow + a rated completed one
  await seedAppraisal(EMP.alice, "2025-26", "self_pending", null);
  await seedAppraisal(EMP.alice, "2024-25", "completed", "4.0");
  // bob: one per remaining bucket
  await seedAppraisal(EMP.bob, "2025-26", "reporting_officer", null);
  await seedAppraisal(EMP.bob, "2024-25", "finalised", "3.5");
  await seedAppraisal(EMP.bob, "2023-24", "pending", null);
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/work-summaries (GAP-HR-WORK-SUMMARY-02)", () => {
  it("returns rating:null for an appraisal that has no rating, and the real number for a rated one", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/work-summaries", headers: auth(HR, ["hr_admin"]) });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ employee: string; period: string; rating: string | null; status: string }>;
    const unrated = rows.find((r) => r.employee === "Alice WN" && r.period === "2025-26");
    expect(unrated?.rating).toBeNull();
    expect(unrated?.rating).not.toBe("0.0");
    const rated = rows.find((r) => r.employee === "Alice WN" && r.period === "2024-25");
    expect(Number(rated?.rating)).toBe(4);
  });

  it("returns per-status counts over the whole scope that add up to total", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/work-summaries", headers: auth(HR, ["hr_admin"]) });
    const body = res.json() as { total: number; statusCounts: Record<string, number> };
    expect(body.total).toBe(5);
    expect(body.statusCounts).toEqual({ self_pending: 1, completed: 1, reporting_officer: 1, finalised: 1, pending: 1 });
    expect(Object.values(body.statusCounts).reduce((a, b) => a + b, 0)).toBe(body.total);
  });

  it("scopes the per-status counts for a non-HR caller to their own records only", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/work-summaries", headers: auth("wn-alice", ["employee"]) });
    const body = res.json() as { total: number; statusCounts: Record<string, number> };
    expect(body.total).toBe(2);
    expect(body.statusCounts).toEqual({ self_pending: 1, completed: 1 });
  });

  it("an employee with no linked record gets empty counts, not an error", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/work-summaries", headers: auth("wn-nobody", ["employee"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: [], total: 0, statusCounts: {} });
  });
});
