/**
 * Overtime requests — employee-identity enrichment, self-approval guard,
 * and create-time validation (real DB, no mocks).
 *
 * Covers three GAP-HR-OVERTIME fixes:
 *  - GAP-HR-OVERTIME-02: GET responses now carry employeeName/employeeNo
 *    resolved via the shared batchEmployees helper, instead of a bare id.
 *  - GAP-HR-OVERTIME-01 (risk note): the approve/reject routes now reject
 *    the case where the deciding HR actor is also the request's own
 *    creator (an hr_admin who filed for themselves via the isHrActor
 *    branch of assertSelfOrHr could otherwise approve/reject their own
 *    request — HR_ROLES membership alone was never checked against the
 *    row's own employeeId).
 *  - GAP-HR-OVERTIME-NEW-04: a second pending/approved request for the
 *    same employee+date is rejected (409); a future-dated request is
 *    rejected (422).
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

function auth(sub: string, roles: string[]): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-ot-test" }, SECRET, 3600)}` };
}

async function seedEmployee(opts: { userRef?: string; fullName: string; employeeNo: string; createdBy: string }): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsEmployees).values({
    id, tenantId: TENANT,
    employeeNo: opts.employeeNo,
    fullName: opts.fullName,
    departmentId: randomUUID(),
    designationId: randomUUID(),
    dateOfJoining: "2020-01-15",
    ...(opts.userRef ? { userRef: opts.userRef } : {}),
    createdBy: opts.createdBy, updatedBy: opts.createdBy,
  }));
  return id;
}

async function seedOvertime(opts: { employeeId: string; requestDate: string; status?: string; createdBy: string }): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsOvertimeRequests).values({
    id, tenantId: TENANT, employeeId: opts.employeeId,
    requestDate: opts.requestDate, hoursRequested: "2.50", reason: "Month-end closing",
    status: opts.status ?? "pending",
    createdBy: opts.createdBy, updatedBy: opts.createdBy,
  }));
  return id;
}

const HR1_ACTOR = randomUUID();
const HR2_ACTOR = randomUUID();

let app: FastifyInstance;
let empId: string;

beforeAll(async () => {
  app = await buildApp();
  empId = await seedEmployee({ userRef: HR1_ACTOR, fullName: "Anita Rao", employeeNo: "E-901", createdBy: HR1_ACTOR });
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("GAP-HR-OVERTIME-02: employee-identity enrichment", () => {
  it("GET /v1/hrms/overtime-requests returns employeeName/employeeNo, not a bare id", async () => {
    await seedOvertime({ employeeId: empId, requestDate: "2026-01-10", createdBy: HR1_ACTOR });
    const r = await app.inject({ method: "GET", url: "/v1/hrms/overtime-requests", headers: auth(HR1_ACTOR, ["hr_admin"]) });
    expect(r.statusCode).toBe(200);
    const row = (r.json().data as Array<Record<string, unknown>>).find((x) => x.employeeId === empId);
    expect(row?.employeeName).toBe("Anita Rao");
    expect(row?.employeeNo).toBe("E-901");
  });
});

describe("GAP-HR-OVERTIME-01: self-approval guard", () => {
  it("the hr_admin who created the request cannot approve it themselves (403, not 202)", async () => {
    const otId = await seedOvertime({ employeeId: empId, requestDate: "2026-01-11", createdBy: HR1_ACTOR });
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/overtime-requests/${otId}/approve`,
      headers: auth(HR1_ACTOR, ["hr_admin"]),
    });
    expect(r.statusCode).toBe(403);
  });

  it("the hr_admin who created the request cannot reject it themselves (403, not 202)", async () => {
    const otId = await seedOvertime({ employeeId: empId, requestDate: "2026-01-12", createdBy: HR1_ACTOR });
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/overtime-requests/${otId}/reject`,
      headers: auth(HR1_ACTOR, ["hr_admin"]),
      payload: {},
    });
    expect(r.statusCode).toBe(403);
  });

  it("a DIFFERENT hr_admin can approve it (202)", async () => {
    const otId = await seedOvertime({ employeeId: empId, requestDate: "2026-01-13", createdBy: HR1_ACTOR });
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/overtime-requests/${otId}/approve`,
      headers: auth(HR2_ACTOR, ["hr_admin"]),
    });
    expect(r.statusCode).toBe(202);
  });
});

describe("GAP-HR-OVERTIME-NEW-04: create-time validation", () => {
  it("rejects a future-dated request (422)", async () => {
    const farFuture = "2099-01-01";
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/overtime-requests",
      headers: auth(HR1_ACTOR, ["employee"]),
      payload: { employeeId: empId, requestDate: farFuture, hoursRequested: 2, reason: "test" },
    });
    expect(r.statusCode).toBe(422);
  });

  it("rejects a second pending request for the same employee+date (409)", async () => {
    const sameDate = "2026-02-01";
    await seedOvertime({ employeeId: empId, requestDate: sameDate, status: "pending", createdBy: HR1_ACTOR });
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/overtime-requests",
      headers: auth(HR1_ACTOR, ["employee"]),
      payload: { employeeId: empId, requestDate: sameDate, hoursRequested: 3, reason: "second attempt" },
    });
    expect(r.statusCode).toBe(409);
  });

  it("allows a new request for a date whose prior request was rejected (not a duplicate)", async () => {
    const sameDate = "2026-02-02";
    await seedOvertime({ employeeId: empId, requestDate: sameDate, status: "rejected", createdBy: HR1_ACTOR });
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/overtime-requests",
      headers: auth(HR1_ACTOR, ["employee"]),
      payload: { employeeId: empId, requestDate: sameDate, hoursRequested: 2, reason: "re-request after rejection" },
    });
    expect(r.statusCode).toBe(202);
  });

  it("allows a normal past-dated, non-duplicate request (202)", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/overtime-requests",
      headers: auth(HR1_ACTOR, ["employee"]),
      payload: { employeeId: empId, requestDate: "2026-02-03", hoursRequested: 1.5, reason: "genuinely new" },
    });
    expect(r.statusCode).toBe(202);
  });
});
