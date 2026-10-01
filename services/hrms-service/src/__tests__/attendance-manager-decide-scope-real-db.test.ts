/**
 * Manager reporting-line guard on WFH / shift-change approve+reject (real
 * DB, no mocks).
 *
 * Discovered, not in the original catalogue: attendance-manager-scope-
 * real-db.test.ts already proves resolveSelfScopedEmployeeId scopes the
 * GET /wfh-requests and /shift-requests LIST queries to self + direct
 * reports (GAP-HR-SF-16 fold-in). But the approve/reject routes next to
 * those GETs only ever checked isSelfApproval (cannot decide your OWN
 * request) — never whether the request belongs to someone in the deciding
 * manager's reporting line at all. A manager could still approve or reject
 * ANY other employee's pending WFH or shift-change request tenant-wide, the
 * same shape of leak GAP-HR-SF-16 already fixed for the list views. Fixed
 * by reusing resolveSelfScopedEmployeeId (assertManagerOwnsReport in
 * routes.ts) in all four approve/reject handlers. HR is unaffected.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { hrmsEmployees } from "../modules/employee/schema.js";
import { hrmsWfhRequests, hrmsShiftChangeRequests } from "../modules/attendance/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();

function auth(sub: string, roles: string[]): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-mgr-decide-test" }, SECRET, 3600)}` };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedEmployee(opts: { userRef?: string; fullName: string; employeeNo: string; managerId?: string; createdBy: string }): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsEmployees).values({
    id, tenantId: TENANT,
    employeeNo: opts.employeeNo,
    fullName: opts.fullName,
    departmentId: randomUUID(),
    designationId: randomUUID(),
    dateOfJoining: "2020-01-15",
    ...(opts.managerId ? { managerId: opts.managerId } : {}),
    ...(opts.userRef ? { userRef: opts.userRef } : {}),
    createdBy: opts.createdBy, updatedBy: opts.createdBy,
  }));
  return id;
}

async function seedWfh(employeeId: string, fromDate: string, createdBy: string): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsWfhRequests).values({
    id, tenantId: TENANT, employeeId, fromDate, toDate: fromDate,
    status: "pending", createdBy, updatedBy: createdBy,
  }));
  return id;
}

async function seedShiftChange(employeeId: string, effectiveDate: string, createdBy: string): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsShiftChangeRequests).values({
    id, tenantId: TENANT, employeeId, currentShift: "day", requestedShift: "night", effectiveDate,
    status: "pending", createdBy, updatedBy: createdBy,
  }));
  return id;
}

const SEED_ACTOR = randomUUID();
const MANAGER_SUB = "mgr-decide-manager";
const OUTSIDER_MGR_SUB = "mgr-decide-outsider-manager";
const HR_SUB = "mgr-decide-hr";

let app: FastifyInstance;
let managerId: string;
let reportId: string;
let outsiderManagerId: string; // same tenant, NOT this report's manager
let outsiderEmployeeId: string;

beforeAll(async () => {
  app = await buildApp();
  managerId = await seedEmployee({ userRef: MANAGER_SUB, fullName: "Manager One", employeeNo: "MD-901", createdBy: SEED_ACTOR });
  reportId = await seedEmployee({ fullName: "Direct Report", employeeNo: "MD-902", managerId, createdBy: SEED_ACTOR });
  outsiderManagerId = await seedEmployee({ userRef: OUTSIDER_MGR_SUB, fullName: "Manager Two", employeeNo: "MD-903", createdBy: SEED_ACTOR });
  outsiderEmployeeId = await seedEmployee({ fullName: "Outsider Report", employeeNo: "MD-904", managerId: outsiderManagerId, createdBy: SEED_ACTOR });
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("PATCH /v1/hrms/wfh-requests/:id/approve|reject — manager must own the report", () => {
  it("a manager CANNOT approve a non-report's pending WFH request (403, not 202)", async () => {
    const id = await seedWfh(outsiderEmployeeId, "2026-02-10", SEED_ACTOR);
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/wfh-requests/${id}/approve`, headers: auth(MANAGER_SUB, ["manager"]) });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NOT_YOUR_REPORT");
  });

  it("a manager CANNOT reject a non-report's pending WFH request (403, not 202)", async () => {
    const id = await seedWfh(outsiderEmployeeId, "2026-02-11", SEED_ACTOR);
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/wfh-requests/${id}/reject`, headers: auth(MANAGER_SUB, ["manager"]), payload: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NOT_YOUR_REPORT");
  });

  it("a manager CAN approve their own direct report's pending WFH request (202)", async () => {
    const id = await seedWfh(reportId, "2026-02-12", SEED_ACTOR);
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/wfh-requests/${id}/approve`, headers: auth(MANAGER_SUB, ["manager"]) });
    expect(r.statusCode).toBe(202);
  });

  it("HR is unaffected: can still decide an employee who is nobody's report of theirs", async () => {
    const id = await seedWfh(outsiderEmployeeId, "2026-02-13", SEED_ACTOR);
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/wfh-requests/${id}/approve`, headers: auth(HR_SUB, ["hr_admin"]) });
    expect(r.statusCode).toBe(202);
  });

  // Regression guard: the pre-existing self-approval guard (isSelfApproval)
  // must still fire BEFORE / independent of the new reporting-line check —
  // a manager who is also linked as their own report's "employee" row must
  // not be able to use this fix as a loophole.
  it("the pre-existing self-approval guard still fires even for a manager deciding their OWN request", async () => {
    const id = await seedWfh(managerId, "2026-02-14", SEED_ACTOR);
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/wfh-requests/${id}/approve`, headers: auth(MANAGER_SUB, ["manager"]) });
    expect(r.statusCode).toBe(403);
  });
});

describe("PATCH /v1/hrms/shift-requests/:id/approve|reject — manager must own the report", () => {
  it("a manager CANNOT approve a non-report's pending shift-change request (403, not 202)", async () => {
    const id = await seedShiftChange(outsiderEmployeeId, "2026-02-15", SEED_ACTOR);
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/shift-requests/${id}/approve`, headers: auth(MANAGER_SUB, ["manager"]) });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NOT_YOUR_REPORT");
  });

  it("a manager CAN reject their own direct report's pending shift-change request (202)", async () => {
    const id = await seedShiftChange(reportId, "2026-02-16", SEED_ACTOR);
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/shift-requests/${id}/reject`, headers: auth(MANAGER_SUB, ["manager"]), payload: {} });
    expect(r.statusCode).toBe(202);
  });

  it("HR is unaffected: can still decide an employee who is nobody's report of theirs", async () => {
    const id = await seedShiftChange(outsiderEmployeeId, "2026-02-17", SEED_ACTOR);
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/shift-requests/${id}/reject`, headers: auth(HR_SUB, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(202);
  });
});
