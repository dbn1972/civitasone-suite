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
import { withTenantScope } from "@civitasone/db";
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

afterAll(async () => {
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
