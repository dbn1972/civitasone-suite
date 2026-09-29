/**
 * GAP-HR-SF-10 (Part 2) — attendance self-approval bypass.
 *
 * The "you cannot approve or reject your own request" guards on
 *   PATCH /v1/hrms/wfh-requests/:id/{approve,reject}
 *   PATCH /v1/hrms/shift-requests/:id/{approve,reject}
 * used to compare the fetched request's employeeId (an hrms_employees.id)
 * against the approving actor's raw ctx.actorId (the JWT subject) — a
 * different id space, see employee/actor-link.ts — so the guard never
 * fired. This was inert (not exploitable) only because Part 1's
 * self-service bug meant a plain employee could not successfully submit
 * their own request in the first place; shipping Part 1's fix alone,
 * without this one, would turn a dead guard into a live self-approval hole
 * for anyone holding both "manager" and "employee" roles (or "hr_admin" and
 * "employee").
 *
 * This suite proves the fix: an actor cannot approve/reject their OWN
 * request even holding manager+employee or HR+employee roles, while a
 * genuinely different manager/HR actor approving a different employee's
 * request still works exactly as before.
 *
 * Pattern: buildApp() + app.inject() + signToken(), matching sibling suites
 * in __tests__/ (e.g. leave-cancel-idor.test.ts, attendance-self-service-
 * idor.test.ts). scopedRead and resolveEmployeeForActor are vi.fn()s so
 * each scenario controls exactly what the DB/actor-link layer returns.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "bbbbbbbb-c002-4000-8000-0000000000f2";

const WFH_REQ_ID   = "77777777-0000-0000-0000-000000000007";
const SHIFT_REQ_ID = "88888888-0000-0000-0000-000000000008";

// The request OWNER and the APPROVER are the SAME person in the bypass
// scenarios below: one hrms_employees row (EMP_SELF_MGR), reached through
// two different id spaces — their JWT subject (ACTOR_SELF_MGR) as approver,
// and their own linked employee id as the request's stored employeeId.
const EMP_SELF_MGR   = "11111111-0000-0000-0000-000000000011";
const ACTOR_SELF_MGR = "a1111111-0000-4000-8000-000000000011";

// A genuinely different manager approving a genuinely different employee.
const EMP_TARGET      = "22222222-0000-0000-0000-000000000022";
const ACTOR_OTHER_MGR = "a2222222-0000-4000-8000-000000000022";
const EMP_OTHER_MGR   = "33333333-0000-0000-0000-000000000033";

// An HR admin who ALSO happens to be the request's own owner.
const ACTOR_HR_SELF = "a5555555-0000-4000-8000-000000000055";

// An HR approver with no linked hrms_employees row at all (a pure service/
// HR account) — the guard cannot possibly apply to them.
const ACTOR_HR_NOLINK = "a9999999-0000-4000-8000-000000000099";

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-attendance-sf10-p2" }, SECRET);
}

function empRow(id: string) {
  return {
    id, tenantId: TENANT, managerId: null, userRef: id,
    email: `${id}@test.gov.in`, employeeType: "permanent", status: "active",
    dateOfJoining: "2024-01-01",
  };
}

function wfhRow(employeeId: string, status = "pending") {
  return { id: WFH_REQ_ID, employeeId, status };
}
function shiftRow(employeeId: string, status = "pending") {
  return { id: SHIFT_REQ_ID, employeeId, status };
}

const scopedReadMock = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();
const resolveEmployeeForActorMock = vi.fn();

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

vi.mock("../modules/employee/actor-link.js", () => ({
  resolveEmployeeForActor: (...args: unknown[]) => resolveEmployeeForActorMock(...args),
}));

import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });
beforeEach(() => {
  scopedReadMock.mockReset();
  resolveEmployeeForActorMock.mockReset();
});

describe("PATCH /v1/hrms/wfh-requests/:id/approve — self-approval guard", () => {
  it("403 — an actor holding BOTH manager and employee roles cannot approve their OWN WFH request", async () => {
    scopedReadMock.mockResolvedValueOnce([wfhRow(EMP_SELF_MGR)]);
    resolveEmployeeForActorMock.mockResolvedValueOnce(empRow(EMP_SELF_MGR));
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/wfh-requests/${WFH_REQ_ID}/approve`,
      headers: { authorization: `Bearer ${tok(["manager", "employee"], ACTOR_SELF_MGR)}` },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("FORBIDDEN");
  });

  it("403 — an HR admin who also happens to own the request cannot approve it either", async () => {
    scopedReadMock.mockResolvedValueOnce([wfhRow(EMP_SELF_MGR)]);
    resolveEmployeeForActorMock.mockResolvedValueOnce(empRow(EMP_SELF_MGR));
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/wfh-requests/${WFH_REQ_ID}/approve`,
      headers: { authorization: `Bearer ${tok(["hr_admin", "employee"], ACTOR_HR_SELF)}` },
    });
    expect(r.statusCode).toBe(403);
  });

  it("202 — a genuinely DIFFERENT manager can approve a different employee's WFH request", async () => {
    scopedReadMock.mockResolvedValueOnce([wfhRow(EMP_TARGET)]);
    resolveEmployeeForActorMock.mockResolvedValueOnce(empRow(EMP_OTHER_MGR));
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/wfh-requests/${WFH_REQ_ID}/approve`,
      headers: { authorization: `Bearer ${tok(["manager"], ACTOR_OTHER_MGR)}` },
    });
    expect(r.statusCode).toBe(202);
  });

  it("202 — an approver with NO linked employee record can still approve someone else's request (guard cannot apply)", async () => {
    scopedReadMock.mockResolvedValueOnce([wfhRow(EMP_TARGET)]);
    resolveEmployeeForActorMock.mockResolvedValueOnce(undefined);
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/wfh-requests/${WFH_REQ_ID}/approve`,
      headers: { authorization: `Bearer ${tok(["hr_admin"], ACTOR_HR_NOLINK)}` },
    });
    expect(r.statusCode).toBe(202);
  });
});

describe("PATCH /v1/hrms/wfh-requests/:id/reject — self-approval guard", () => {
  it("403 — cannot reject your OWN WFH request", async () => {
    scopedReadMock.mockResolvedValueOnce([wfhRow(EMP_SELF_MGR)]);
    resolveEmployeeForActorMock.mockResolvedValueOnce(empRow(EMP_SELF_MGR));
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/wfh-requests/${WFH_REQ_ID}/reject`,
      headers: { authorization: `Bearer ${tok(["manager", "employee"], ACTOR_SELF_MGR)}` },
      payload: { reason: "not needed" },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("FORBIDDEN");
  });

  it("202 — a genuinely different manager can reject a different employee's WFH request", async () => {
    scopedReadMock.mockResolvedValueOnce([wfhRow(EMP_TARGET)]);
    resolveEmployeeForActorMock.mockResolvedValueOnce(empRow(EMP_OTHER_MGR));
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/wfh-requests/${WFH_REQ_ID}/reject`,
      headers: { authorization: `Bearer ${tok(["manager"], ACTOR_OTHER_MGR)}` },
      payload: { reason: "insufficient justification" },
    });
    expect(r.statusCode).toBe(202);
  });
});

describe("PATCH /v1/hrms/shift-requests/:id/approve — self-approval guard", () => {
  it("403 — an actor holding BOTH manager and employee roles cannot approve their OWN shift-change request", async () => {
    scopedReadMock.mockResolvedValueOnce([shiftRow(EMP_SELF_MGR)]);
    resolveEmployeeForActorMock.mockResolvedValueOnce(empRow(EMP_SELF_MGR));
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/shift-requests/${SHIFT_REQ_ID}/approve`,
      headers: { authorization: `Bearer ${tok(["manager", "employee"], ACTOR_SELF_MGR)}` },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("FORBIDDEN");
  });

  it("202 — a genuinely DIFFERENT manager can approve a different employee's shift-change request", async () => {
    scopedReadMock.mockResolvedValueOnce([shiftRow(EMP_TARGET)]);
    resolveEmployeeForActorMock.mockResolvedValueOnce(empRow(EMP_OTHER_MGR));
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/shift-requests/${SHIFT_REQ_ID}/approve`,
      headers: { authorization: `Bearer ${tok(["manager"], ACTOR_OTHER_MGR)}` },
    });
    expect(r.statusCode).toBe(202);
  });
});

describe("PATCH /v1/hrms/shift-requests/:id/reject — self-approval guard", () => {
  it("403 — cannot reject your OWN shift-change request", async () => {
    scopedReadMock.mockResolvedValueOnce([shiftRow(EMP_SELF_MGR)]);
    resolveEmployeeForActorMock.mockResolvedValueOnce(empRow(EMP_SELF_MGR));
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/shift-requests/${SHIFT_REQ_ID}/reject`,
      headers: { authorization: `Bearer ${tok(["manager", "employee"], ACTOR_SELF_MGR)}` },
      payload: { reason: "n/a" },
    });
    expect(r.statusCode).toBe(403);
  });

  it("202 — a genuinely different manager can reject a different employee's shift-change request", async () => {
    scopedReadMock.mockResolvedValueOnce([shiftRow(EMP_TARGET)]);
    resolveEmployeeForActorMock.mockResolvedValueOnce(empRow(EMP_OTHER_MGR));
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/shift-requests/${SHIFT_REQ_ID}/reject`,
      headers: { authorization: `Bearer ${tok(["manager"], ACTOR_OTHER_MGR)}` },
      payload: { reason: "insufficient" },
    });
    expect(r.statusCode).toBe(202);
  });
});
