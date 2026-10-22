/**
 * GAP-HR-WFH-01 (partial — weekly cap only; real DB, no mocks).
 *
 * DoPT OM 2022 caps WFH at 2 days/week. The OTHER half of this gap (reject
 * gazetted/Level>10 staff outright) is deliberately NOT implemented: neither
 * hrms_employees nor hrms_designations exposes a column confirmed to be the
 * GoI pay-matrix level this policy means (designations only has
 * level/payGrade, whose mapping to it was never verified) — left open
 * rather than guessed at, per this gap's own catalogue entry ("Needs:
 * decision"). This file covers only the part that is safe to enforce
 * unconditionally: it only ever adds a restriction, never grants the
 * gazetted exemption it doesn't check.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { hrmsEmployees } from "../modules/employee/schema.js";
import { hrmsWfhRequests } from "../modules/attendance/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const SEED_ACTOR = randomUUID();
const EMP_SUB = "wfh-cap-employee";

function auth(sub: string, roles: string[]): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-wfh-cap-test" }, SECRET, 3600)}` };
}

async function seedWfh(employeeId: string, fromDate: string, toDate: string, status: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsWfhRequests).values({
    id: randomUUID(), tenantId: TENANT, employeeId, fromDate, toDate,
    status, createdBy: SEED_ACTOR, updatedBy: SEED_ACTOR,
  }));
}

let app: FastifyInstance;
let empId: string;

beforeAll(async () => {
  app = await buildApp();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsEmployees).values({
    id: (empId = randomUUID()), tenantId: TENANT, userRef: EMP_SUB,
    employeeNo: "WFC-001", fullName: "Cap Test Employee",
    departmentId: randomUUID(), designationId: randomUUID(), dateOfJoining: "2020-01-15",
    createdBy: SEED_ACTOR, updatedBy: SEED_ACTOR,
  }));
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/hrms/wfh-requests — weekly cap (GAP-HR-WFH-01, partial)", () => {
  it("allows the 1st WFH day in a week with none yet", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/wfh-requests", headers: auth(EMP_SUB, ["employee"]),
      payload: { employeeId: empId, fromDate: "2026-03-02", toDate: "2026-03-02" }, // Monday
    });
    expect(r.statusCode).toBe(202);
  });

  it("allows a 2nd WFH day in a week that already has exactly 1 pending/approved", async () => {
    // POST is a 202-accepted async write (the row only exists once the
    // queue consumer runs) — seed the 1st day directly rather than chain
    // off a prior POST's unconfirmed side effect, same reasoning
    // attendance-wfh-weekly-cap/overtime's own duplicate-check tests use.
    await seedWfh(empId, "2026-03-23", "2026-03-23", "approved"); // Monday
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/wfh-requests", headers: auth(EMP_SUB, ["employee"]),
      payload: { employeeId: empId, fromDate: "2026-03-24", toDate: "2026-03-24" }, // Tuesday, same week
    });
    expect(r.statusCode).toBe(202);
  });

  it("rejects a 3rd WFH day in a week that already has 2 pending/approved (422)", async () => {
    await seedWfh(empId, "2026-03-09", "2026-03-09", "pending"); // Monday
    await seedWfh(empId, "2026-03-10", "2026-03-10", "approved"); // Tuesday
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/wfh-requests", headers: auth(EMP_SUB, ["employee"]),
      payload: { employeeId: empId, fromDate: "2026-03-11", toDate: "2026-03-11" }, // Wednesday, same week
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("WEEKLY_WFH_CAP_REACHED");
  });

  it("a REJECTED request does not count toward the cap (a rejected day is not a 'used' day)", async () => {
    await seedWfh(empId, "2026-03-16", "2026-03-16", "rejected"); // Monday
    await seedWfh(empId, "2026-03-17", "2026-03-17", "rejected"); // Tuesday
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/wfh-requests", headers: auth(EMP_SUB, ["employee"]),
      payload: { employeeId: empId, fromDate: "2026-03-18", toDate: "2026-03-18" }, // Wednesday, same week
    });
    expect(r.statusCode).toBe(202);
  });

  it("a request the following week is unaffected by the prior week's cap", async () => {
    await seedWfh(empId, "2026-03-23", "2026-03-23", "approved"); // Monday
    await seedWfh(empId, "2026-03-24", "2026-03-24", "approved"); // Tuesday
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/wfh-requests", headers: auth(EMP_SUB, ["employee"]),
      payload: { employeeId: empId, fromDate: "2026-03-30", toDate: "2026-03-30" }, // next Monday
    });
    expect(r.statusCode).toBe(202);
  });
});

// GAP-HR-WFH-01 (rescan): the cap is counted in DAYS. Until now it counted
// existing request ROWS whose fromDate fell in the week and ignored the new
// request's own span, so one Monday-Friday request (a single row) passed.
// 2026-04-06, 04-13, 04-20, 05-04, 05-11 and 05-18 are Mondays.
describe("POST /v1/hrms/wfh-requests — weekly cap is counted in days (GAP-HR-WFH-01)", () => {
  const post = (fromDate: string, toDate: string) => app.inject({
    method: "POST", url: "/v1/hrms/wfh-requests", headers: auth(EMP_SUB, ["employee"]),
    payload: { employeeId: empId, fromDate, toDate },
  });

  it("rejects a SINGLE Monday-to-Friday request: one row, five days (422 WEEKLY_WFH_CAP_REACHED)", async () => {
    const r = await post("2026-04-06", "2026-04-10");
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("WEEKLY_WFH_CAP_REACHED");
  });

  it("rejects a 3-day request even in an otherwise empty week, and allows a 2-day one", async () => {
    expect((await post("2026-04-13", "2026-04-15")).statusCode).toBe(422);
    expect((await post("2026-04-13", "2026-04-14")).statusCode).toBe(202);
  });

  it("an existing MULTI-day request counts by its days: Mon-Tue on file (one row) leaves no room for a Thursday", async () => {
    await seedWfh(empId, "2026-04-20", "2026-04-21", "approved");
    const r = await post("2026-04-23", "2026-04-23");
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("WEEKLY_WFH_CAP_REACHED");
  });

  it("a request that straddles two ISO weeks is counted per week (Sun | Mon+Tue is within the cap; Fri-Sun is not)", async () => {
    expect((await post("2026-05-17", "2026-05-19")).statusCode).toBe(202); // Sun | Mon, Tue
    expect((await post("2026-05-15", "2026-05-17")).statusCode).toBe(422); // Fri, Sat, Sun = 3 calendar days
  });

  it("a day already held by an existing request is not double-counted", async () => {
    await seedWfh(empId, "2026-05-04", "2026-05-05", "pending");
    expect((await post("2026-05-05", "2026-05-05")).statusCode).toBe(202);
    expect((await post("2026-05-06", "2026-05-06")).statusCode).toBe(422);
  });

  it("an impossible calendar date is a 400, not a 500", async () => {
    const r = await post("2026-13-45", "2026-13-46");
    expect(r.statusCode).toBe(400);
  });

  it("GET /wfh-eligibility reports DAYS used in the current week (a Mon-Tue row = 2), with the cap", async () => {
    const now = new Date();
    const dow = (now.getUTCDay() + 6) % 7; // Monday = 0
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow));
    const day = (offset: number) => new Date(monday.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    await seedWfh(empId, day(0), day(1), "approved");
    const r = await app.inject({ method: "GET", url: `/v1/hrms/wfh-eligibility?employeeId=${empId}`, headers: auth(EMP_SUB, ["employee"]) });
    expect(r.statusCode).toBe(200);
    // weekStart/weekEnd name the Monday-Sunday week the count is for, so the request form applies the
    // count only to dates inside it (a later week has its own, separate allowance).
    expect(r.json()).toMatchObject({ weeklyWfhCount: 2, weeklyCap: 2, weekStart: day(0), weekEnd: day(6) });
  });
});
