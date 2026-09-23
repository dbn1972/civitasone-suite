/**
 * Leave-cancel IDOR tests.
 *
 * PATCH /v1/hrms/leave-applications/:id/cancel had no ownership check:
 * any employee who knew a leave-application UUID could cancel another
 * employee's pending/approved leave. This suite proves the fix:
 *
 *  1. An employee CAN cancel their own leave.
 *  2. A manager CAN cancel a direct report's leave.
 *  3. An employee CANNOT cancel another employee's leave (403).
 *  4. HR admin CAN cancel any employee's leave.
 *
 * Pattern: buildApp() + app.inject() + signToken(), matching sibling
 * suites in __tests__/. scopedRead is a vi.fn() so each test scenario
 * controls what the DB-layer calls return (leave app, actor employee,
 * target employee).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-c001-4000-8000-000000000099";

const EMP_SELF_ID   = "11111111-0000-0000-0000-000000000001";
const EMP_TARGET_ID = "22222222-0000-0000-0000-000000000002";
const EMP_OTHER_ID  = "33333333-0000-0000-0000-000000000003";
const MGR_ID        = "44444444-0000-0000-0000-000000000004";
const HR_ACTOR_ID   = "55555555-0000-0000-0000-000000000005";
const LEAVE_APP_ID  = "66666666-0000-0000-0000-000000000006";

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-cancel-idor-test" }, SECRET);
}

/** Minimal leave-application row shape returned by scopedRead. */
function leaveApp(employeeId: string, status = "pending") {
  return {
    id: LEAVE_APP_ID,
    tenantId: TENANT,
    employeeId,
    leaveTypeId: "aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa",
    allocId: "bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb",
    fromDate: "2026-10-01",
    toDate: "2026-10-03",
    daysApplied: 3,
    reason: "vacation",
    approvedBy: null,
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: employeeId,
    updatedBy: employeeId,
    version: 1,
  };
}

/** Minimal employee row shape. */
function empRow(id: string, managerId: string | null = null) {
  return {
    id,
    tenantId: TENANT,
    managerId,
    userRef: id,
    email: `${id}@test.gov.in`,
    employeeType: "permanent",
    status: "active",
    dateOfJoining: "2024-01-01",
  };
}

// --- Mocks ---

const scopedReadMock = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();

vi.mock("../shared/db.js", () => {
  const sqlClientFn = (..._args: unknown[]) => Promise.resolve([]);
  sqlClientFn.end = vi.fn(async () => {});
  sqlClientFn.unsafe = vi.fn((..._args: unknown[]) => Promise.resolve([]));
  sqlClientFn.begin = vi.fn(async (fn: (tx: typeof sqlClientFn) => Promise<unknown>) => fn(sqlClientFn));
  return {
    db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
    sqlClient: sqlClientFn,
    scopedRead: (...args: unknown[]) => scopedReadMock(...args),
  };
});

vi.mock("../shared/infra.js", () => ({
  queue: { publish: vi.fn(async () => {}), subscribe: vi.fn(), drain: vi.fn(async () => {}) },
  cache: { get: vi.fn(async () => null), set: vi.fn(async () => {}), del: vi.fn(async () => {}) },
}));

import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });
beforeEach(() => { scopedReadMock.mockReset(); });

describe("PATCH /v1/hrms/leave-applications/:id/cancel — IDOR guard", () => {

  it("200 — employee cancels their OWN leave", async () => {
    // Call 1: fetch leave application (employeeId = EMP_SELF_ID)
    scopedReadMock.mockResolvedValueOnce([leaveApp(EMP_SELF_ID)]);
    // Call 2: resolveEmployeeForActor — actor's employee row
    scopedReadMock.mockResolvedValueOnce([empRow(EMP_SELF_ID)]);

    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/leave-applications/${LEAVE_APP_ID}/cancel`,
      headers: { authorization: `Bearer ${tok(["employee"], EMP_SELF_ID)}` },
    });
    expect(r.statusCode).toBe(202);
  });

  it("200 — manager cancels a direct report's leave", async () => {
    // Call 1: fetch leave application (belongs to EMP_TARGET_ID)
    scopedReadMock.mockResolvedValueOnce([leaveApp(EMP_TARGET_ID)]);
    // Call 2: resolveEmployeeForActor — manager's employee row
    scopedReadMock.mockResolvedValueOnce([empRow(MGR_ID)]);
    // Call 3: look up target employee to check managerId
    scopedReadMock.mockResolvedValueOnce([empRow(EMP_TARGET_ID, MGR_ID)]);

    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/leave-applications/${LEAVE_APP_ID}/cancel`,
      headers: { authorization: `Bearer ${tok(["manager"], MGR_ID)}` },
    });
    expect(r.statusCode).toBe(202);
  });

  it("403 — employee CANNOT cancel another employee's leave", async () => {
    // Call 1: fetch leave application (belongs to EMP_TARGET_ID)
    scopedReadMock.mockResolvedValueOnce([leaveApp(EMP_TARGET_ID)]);
    // Call 2: resolveEmployeeForActor — returns a different employee
    scopedReadMock.mockResolvedValueOnce([empRow(EMP_OTHER_ID)]);

    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/leave-applications/${LEAVE_APP_ID}/cancel`,
      headers: { authorization: `Bearer ${tok(["employee"], EMP_OTHER_ID)}` },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("FORBIDDEN");
  });

  it("200 — hr_admin can cancel ANY employee's leave", async () => {
    // Call 1: fetch leave application (belongs to EMP_TARGET_ID)
    scopedReadMock.mockResolvedValueOnce([leaveApp(EMP_TARGET_ID)]);
    // HR actor — ownership check skipped entirely, no further scopedRead calls

    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/leave-applications/${LEAVE_APP_ID}/cancel`,
      headers: { authorization: `Bearer ${tok(["hr_admin"], HR_ACTOR_ID)}` },
    });
    expect(r.statusCode).toBe(202);
  });

  it("403 — manager CANNOT cancel a non-report's leave", async () => {
    // Call 1: fetch leave application (belongs to EMP_TARGET_ID)
    scopedReadMock.mockResolvedValueOnce([leaveApp(EMP_TARGET_ID)]);
    // Call 2: resolveEmployeeForActor — manager's employee row
    scopedReadMock.mockResolvedValueOnce([empRow(MGR_ID)]);
    // Call 3: look up target employee — managerId does NOT match MGR_ID
    scopedReadMock.mockResolvedValueOnce([empRow(EMP_TARGET_ID, EMP_OTHER_ID)]);

    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/leave-applications/${LEAVE_APP_ID}/cancel`,
      headers: { authorization: `Bearer ${tok(["manager"], MGR_ID)}` },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("FORBIDDEN");
  });
});
