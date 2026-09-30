/**
 * Travel requests — approver queue (?scope=team), reporting-line
 * authorization, and self-decision guard (real DB, no mocks).
 *
 * GAP-HR-TRAVEL-01: before this PR, GET /v1/hrms/travel-requests was
 * ALWAYS self-scoped (WHERE employee_id = ctx.actorId, unconditionally) --
 * there was no way for a manager/HR to ever see a pending request to act
 * on. Approve already blocked self-approval but let ANY manager/HR decide
 * ANY employee's request; reject had neither guard at all.
 *
 * Id-space note: claims.hrms_travel_requests.employee_id stores the JWT
 * actor id (ctx.actorId / hrms_employees.user_ref), NOT hrms_employees.id
 * -- confirmed by the POST handler inserting ctx.actorId directly. Seeding
 * below sets each employee's user_ref to the same value used as their
 * travel-request employee_id and as the JWT `sub`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();

function auth(sub: string, roles: string[]): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-travel-scope" }, SECRET, 3600)}` };
}

async function seedEmployee(opts: { actorId: string; fullName: string; managerEmpId?: string; createdBy: string }): Promise<string> {
  const id = randomUUID();
  await withRawTenantGuc(sqlClient, TENANT, (tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, status, user_ref, manager_id, created_by, updated_by)
    VALUES
      (${id}, ${TENANT}, ${`TRV-${id.slice(0, 8)}`}, ${opts.fullName}, ${randomUUID()}, ${randomUUID()}, '2020-01-01', 'confirmed', ${opts.actorId}, ${opts.managerEmpId ?? null}, ${opts.createdBy}, ${opts.createdBy})
  `);
  return id;
}

async function seedTravelRequest(opts: { employeeActorId: string; status?: string }): Promise<string> {
  const id = randomUUID();
  await withRawTenantGuc(sqlClient, TENANT, (tx) => tx`
    INSERT INTO claims.hrms_travel_requests
      (id, tenant_id, employee_id, purpose, destination, from_date, to_date, advance_required, mode, status, created_at, updated_at)
    VALUES
      (${id}, ${TENANT}, ${opts.employeeActorId}, 'Field inspection', 'Pune', '2026-10-01', '2026-10-03', 0, 'rail', ${opts.status ?? "pending"}, NOW(), NOW())
  `);
  return id;
}

const HR_ACTOR = randomUUID();
const MANAGER_ACTOR = randomUUID();
const REPORT_ACTOR = randomUUID();
const OUTSIDER_ACTOR = randomUUID();
const UNLINKED_MANAGER_ACTOR = randomUUID();

let app: FastifyInstance;
let managerEmpId: string;

beforeAll(async () => {
  app = await buildApp();
  managerEmpId = await seedEmployee({ actorId: MANAGER_ACTOR, fullName: "Manager Travel-Scope", createdBy: HR_ACTOR });
  await seedEmployee({ actorId: REPORT_ACTOR, fullName: "Report Travel-Scope", managerEmpId, createdBy: HR_ACTOR });
  // Same tenant, but does NOT report to the manager above -- the "exists but not yours" case.
  await seedEmployee({ actorId: OUTSIDER_ACTOR, fullName: "Outsider Travel-Scope", createdBy: HR_ACTOR });
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/travel-requests?scope=team", () => {
  it("a manager sees a direct report's request, not the outsider's", async () => {
    const reportReq = await seedTravelRequest({ employeeActorId: REPORT_ACTOR });
    const outsiderReq = await seedTravelRequest({ employeeActorId: OUTSIDER_ACTOR });
    const r = await app.inject({ method: "GET", url: "/v1/hrms/travel-requests?scope=team", headers: auth(MANAGER_ACTOR, ["manager"]) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json().data as Array<{ id: string }>).map((x) => x.id);
    expect(ids).toContain(reportReq);
    expect(ids).not.toContain(outsiderReq);
  });

  it("includes the resolved employee name for the approver's queue", async () => {
    await seedTravelRequest({ employeeActorId: REPORT_ACTOR });
    const r = await app.inject({ method: "GET", url: "/v1/hrms/travel-requests?scope=team", headers: auth(MANAGER_ACTOR, ["manager"]) });
    const row = (r.json().data as Array<{ employee_id: string; employeeName?: string }>).find((x) => x.employee_id === REPORT_ACTOR);
    expect(row?.employeeName).toBe("Report Travel-Scope");
  });

  it("hr_admin sees the outsider's request too (unrestricted)", async () => {
    const outsiderReq = await seedTravelRequest({ employeeActorId: OUTSIDER_ACTOR });
    const r = await app.inject({ method: "GET", url: "/v1/hrms/travel-requests?scope=team", headers: auth(HR_ACTOR, ["hr_admin"]) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json().data as Array<{ id: string }>).map((x) => x.id);
    expect(ids).toContain(outsiderReq);
  });

  it("a manager with no resolvable employee link fails CLOSED to an empty list", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/travel-requests?scope=team", headers: auth(UNLINKED_MANAGER_ACTOR, ["manager"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual([]);
  });

  it("a plain employee cannot request team scope (403)", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/travel-requests?scope=team", headers: auth(REPORT_ACTOR, ["employee"]) });
    expect(r.statusCode).toBe(403);
  });

  it("default (no scope param) stays self-scoped, unchanged", async () => {
    const mine = await seedTravelRequest({ employeeActorId: REPORT_ACTOR });
    const r = await app.inject({ method: "GET", url: "/v1/hrms/travel-requests", headers: auth(REPORT_ACTOR, ["employee"]) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json().data as Array<{ id: string }>).map((x) => x.id);
    expect(ids).toContain(mine);
  });
});

describe("PATCH /v1/hrms/travel-requests/:id/approve — reporting-line authorization", () => {
  it("the requester's own manager can approve (202)", async () => {
    const reqId = await seedTravelRequest({ employeeActorId: REPORT_ACTOR });
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/travel-requests/${reqId}/approve`, headers: auth(MANAGER_ACTOR, ["manager"]) });
    expect(r.statusCode).toBe(200);
  });

  it("a manager who is NOT the requester's reporting manager cannot approve (403)", async () => {
    const reqId = await seedTravelRequest({ employeeActorId: OUTSIDER_ACTOR });
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/travel-requests/${reqId}/approve`, headers: auth(MANAGER_ACTOR, ["manager"]) });
    expect(r.statusCode).toBe(403);
  });

  it("hr_admin can approve regardless of reporting line (unrestricted)", async () => {
    const reqId = await seedTravelRequest({ employeeActorId: OUTSIDER_ACTOR });
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/travel-requests/${reqId}/approve`, headers: auth(HR_ACTOR, ["hr_admin"]) });
    expect(r.statusCode).toBe(200);
  });

  it("the requester still cannot approve their own request (self-approval, unchanged)", async () => {
    const reqId = await seedTravelRequest({ employeeActorId: REPORT_ACTOR });
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/travel-requests/${reqId}/approve`, headers: auth(REPORT_ACTOR, ["manager"]) });
    expect(r.statusCode).toBe(403);
  });
});

describe("PATCH /v1/hrms/travel-requests/:id/reject — same guards as approve", () => {
  it("the requester's own manager can reject with a reason (200)", async () => {
    const reqId = await seedTravelRequest({ employeeActorId: REPORT_ACTOR });
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/travel-requests/${reqId}/reject`,
      headers: auth(MANAGER_ACTOR, ["manager"]), payload: { reason: "Budget exceeded" },
    });
    expect(r.statusCode).toBe(200);
  });

  it("a manager who is NOT the requester's reporting manager cannot reject (403) -- reject previously had NO reporting-line or self-decision guard at all", async () => {
    const reqId = await seedTravelRequest({ employeeActorId: OUTSIDER_ACTOR });
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/travel-requests/${reqId}/reject`,
      headers: auth(MANAGER_ACTOR, ["manager"]), payload: { reason: "Not my call" },
    });
    expect(r.statusCode).toBe(403);
  });

  it("the requester cannot reject their own request (self-decision guard, new)", async () => {
    const reqId = await seedTravelRequest({ employeeActorId: REPORT_ACTOR });
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/travel-requests/${reqId}/reject`,
      headers: auth(REPORT_ACTOR, ["manager"]), payload: { reason: "Self-reject attempt" },
    });
    expect(r.statusCode).toBe(403);
  });

  it("a reason over 500 characters is rejected (400)", async () => {
    const reqId = await seedTravelRequest({ employeeActorId: REPORT_ACTOR });
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/travel-requests/${reqId}/reject`,
      headers: auth(MANAGER_ACTOR, ["manager"]), payload: { reason: "x".repeat(501) },
    });
    expect(r.statusCode).toBe(400);
  });
});
